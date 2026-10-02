import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { KeychainTimeoutError } from "../errors.js";
import { withFileLock, writeFileAtomic } from "../fs-lock.js";

const SERVICE_NAME = "wave-cli";

export interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

const KEYTAR_METHODS = ["setPassword", "getPassword", "deletePassword", "findCredentials"] as const;

/**
 * Pick the usable keytar object out of whatever `import("keytar")` returned.
 *
 * keytar is CommonJS. Under Node ESM, `await import("keytar")` returns a module NAMESPACE whose
 * named exports are only what cjs-module-lexer could statically detect (for keytar 7.9 that is
 * `getPassword` alone), while the full `module.exports` object sits on `.default`. 1.0.10 cast the
 * namespace straight to KeytarLike, so `setPassword`/`deletePassword`/`findCredentials` were
 * `undefined` and `wave auth login --api-key` crashed with "keytar.setPassword is not a function".
 *
 * Returns null unless every method this module calls is a real function, so a partial module is
 * never used. getKeytar() refuses such a module loudly rather than degrading to the file store.
 */
export function resolveKeytarModule(mod: unknown): KeytarLike | null {
  if (!mod || (typeof mod !== "object" && typeof mod !== "function")) return null;
  const candidates = [(mod as { default?: unknown }).default, mod];
  for (const candidate of candidates) {
    if (!candidate || (typeof candidate !== "object" && typeof candidate !== "function")) continue;
    const record = candidate as Record<string, unknown>;
    if (KEYTAR_METHODS.every((m) => typeof record[m] === "function")) {
      return candidate as KeytarLike;
    }
  }
  return null;
}

let keytarModule: KeytarLike | null = null;
let keytarChecked = false;
/** Why keytar could not be loaded (its native binding failed); shown when falling back to the file. */
let keytarUnavailableReason: string | null = null;
/** Set when keytar loaded but is missing methods: a broken install, refused rather than used. */
let keytarIncompatible: Error | null = null;
let fileFallbackNoticeShown = false;

/**
 * `WAVE_CREDENTIAL_STORE=file` forces the ~/.wave/credentials.json store (headless Linux without
 * libsecret, containers, CI runners, tests). Anything else uses the OS keychain when available.
 */
function fileStoreForced(): boolean {
  return (process.env["WAVE_CREDENTIAL_STORE"] ?? "").toLowerCase() === "file";
}

/**
 * The keychain module, or null when this machine has none (the native binding cannot load: Linux
 * without libsecret, an unsupported platform). Those fall back to the 0600 credentials file.
 *
 * A keytar that loads but lacks a method is different: that is a broken or mismatched install,
 * and silently storing secrets in plaintext instead would hide it. It fails loudly and names the
 * explicit opt-in (WAVE_CREDENTIAL_STORE=file).
 */
async function getKeytar(): Promise<KeytarLike | null> {
  if (fileStoreForced()) return null;
  if (!keytarChecked) {
    keytarChecked = true;
    let mod: unknown;
    try {
      mod = await import(/* webpackIgnore: true */ "keytar" as string);
    } catch (err) {
      keytarModule = null;
      keytarUnavailableReason = err instanceof Error ? err.message.split("\n")[0]! : String(err);
      return null;
    }
    keytarModule = resolveKeytarModule(mod);
    if (!keytarModule) keytarIncompatible = incompatibleKeytarError();
  }
  if (keytarIncompatible) throw keytarIncompatible;
  return keytarModule;
}

function incompatibleKeytarError(): Error {
  return new Error(
    "The installed keytar module does not provide setPassword/getPassword/deletePassword/" +
      "findCredentials, so the OS keychain cannot be used. Reinstall with " +
      "`npm install -g @wave-av/cli`, set WAVE_API_KEY for this shell, or opt in to the " +
      "~/.wave/credentials.json store (mode 0600) with WAVE_CREDENTIAL_STORE=file.",
  );
}

/** Say once, on stderr, that a secret is going to the file because no keychain could load. */
function noteFileFallback(): void {
  if (fileFallbackNoticeShown || fileStoreForced() || !keytarUnavailableReason) return;
  fileFallbackNoticeShown = true;
  process.stderr.write(
    `Note: the OS keychain is unavailable (${keytarUnavailableReason}). Credentials are stored in ` +
      `${credentialsFile()} (mode 0600). Set WAVE_CREDENTIAL_STORE=file to use it without this note.\n`,
  );
}

/** Which backend credentials are read from and written to on this machine right now. */
export async function credentialBackend(): Promise<"keychain" | "file"> {
  return (await getKeytar()) ? "keychain" : "file";
}

/** Long enough for a person to answer the OS "allow access" prompt; `WAVE_KEYCHAIN_TIMEOUT_MS` overrides. */
const DEFAULT_KEYCHAIN_TIMEOUT_MS = 60_000;

/**
 * The longest delay a Node timer honors (2^31-1 ms, about 24.8 days). Node replaces anything larger
 * with 1 ms, so an override meant as "wait as long as it takes" (say 1e15) would instead fail every
 * keychain call at once. Larger values, `Infinity` included, are capped here.
 */
const MAX_TIMER_MS = 2_147_483_647;

function keychainTimeoutMs(): number {
  const raw = Number(process.env["WAVE_KEYCHAIN_TIMEOUT_MS"]);
  // NaN (unset or not a number), zero and negatives keep the default.
  return raw > 0 ? Math.min(raw, MAX_TIMER_MS) : DEFAULT_KEYCHAIN_TIMEOUT_MS;
}

/**
 * Bound a keychain call. A locked macOS login keychain blocks keytar's write until someone answers
 * an unlock prompt, and where nobody can (a locked screen, some headless sessions) `wave auth login
 * --api-key` hung forever with no output. After the timeout the command fails with what to do
 * instead. It never falls back to the plaintext file silently: that choice belongs to the user
 * (`WAVE_CREDENTIAL_STORE=file`).
 */
async function withKeychainTimeout<T>(operation: string, work: Promise<T>): Promise<T> {
  const ms = keychainTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new KeychainTimeoutError(
          `The OS keychain did not answer within ${Math.round(ms / 1000)}s (${operation}). It is ` +
            "usually locked and waiting for an unlock prompt this session cannot show (SSH, CI, a " +
            "locked screen). Unlock it (`security unlock-keychain` on macOS), set WAVE_API_KEY for " +
            "this shell, or store credentials in ~/.wave/credentials.json with WAVE_CREDENTIAL_STORE=file.",
        ),
      );
    }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function setSecret(account: string, value: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await withKeychainTimeout("store", keytar.setPassword(SERVICE_NAME, account, value));
    return;
  }
  noteFileFallback();
  await updateCredentials((creds) => {
    creds[account] = value;
    return true;
  });
}

async function getSecret(account: string): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    return withKeychainTimeout("read", keytar.getPassword(SERVICE_NAME, account));
  }
  const creds = await loadCredentials();
  return creds[account] ?? null;
}

async function deleteSecret(account: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await withKeychainTimeout("delete", keytar.deletePassword(SERVICE_NAME, account));
    return;
  }
  await updateCredentials((creds) => {
    if (!(account in creds)) return false;
    delete creds[account];
    return true;
  });
}

export async function storeApiKey(project: string, key: string): Promise<void> {
  await setSecret(`apikey:${project}`, key);
}

export async function getApiKey(project: string): Promise<string | null> {
  return getSecret(`apikey:${project}`);
}

export async function deleteApiKey(project: string): Promise<void> {
  await deleteSecret(`apikey:${project}`);
  await deleteSecret(`refresh:${project}`);
}

/** Device-flow refresh token, stored beside the access token it rotates. */
export async function storeRefreshToken(project: string, token: string): Promise<void> {
  await setSecret(`refresh:${project}`, token);
}

export async function getRefreshToken(project: string): Promise<string | null> {
  return getSecret(`refresh:${project}`);
}

export async function deleteAllKeys(): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    const credentials = await withKeychainTimeout("list", keytar.findCredentials(SERVICE_NAME));
    for (const cred of credentials) {
      await withKeychainTimeout("delete", keytar.deletePassword(SERVICE_NAME, cred.account));
    }
    return;
  }
  await updateCredentials((creds) => {
    const accounts = Object.keys(creds);
    for (const account of accounts) delete creds[account];
    return accounts.length > 0;
  });
}

// File store, used when keytar is unavailable or WAVE_CREDENTIAL_STORE=file. Entries use the same
// account names as the keychain ("apikey:<project>", "refresh:<project>").

function credentialsDir(): string {
  return join(homedir(), ".wave");
}

function credentialsFile(): string {
  return join(credentialsDir(), "credentials.json");
}

/**
 * Read the credentials map. A missing or empty file is an empty map. A file that exists but does
 * not parse is an error: treating it as empty would let the next write replace it and lose every
 * stored key.
 */
async function loadCredentials(): Promise<Record<string, string>> {
  const file = credentialsFile();
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  if (!raw.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `${file} is not a valid credentials file. Move it aside and run \`wave auth login\` again; ` +
        "the CLI will not overwrite it.",
    );
  }
  // 1.0.10 and earlier keyed file entries by bare project name: read those as API keys.
  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === "string") normalized[k.includes(":") ? k : `apikey:${k}`] = v;
  }
  return normalized;
}

/**
 * Read-modify-write of the credentials file under an inter-process lock, written atomically with
 * mode 0600. Without the lock, two processes (a token refresh and a login to another project)
 * could each read the same map and the later write would drop the other's new secret.
 */
async function updateCredentials(mutate: (creds: Record<string, string>) => boolean): Promise<void> {
  const file = credentialsFile();
  await withFileLock(file, async () => {
    const creds = await loadCredentials();
    if (!mutate(creds)) return; // nothing changed: leave the file (or its absence) alone
    await writeFileAtomic(file, JSON.stringify(creds, null, 2), 0o600);
  });
}

/** Test hook: forget the cached keytar lookup so the next call resolves it again. */
export function resetKeytarCacheForTests(): void {
  keytarModule = null;
  keytarChecked = false;
  keytarUnavailableReason = null;
  keytarIncompatible = null;
  fileFallbackNoticeShown = false;
}

/** Test hook: use this keychain implementation instead of importing keytar. */
export function useKeytarForTests(mod: KeytarLike): void {
  keytarModule = mod;
  keytarChecked = true;
  keytarIncompatible = null;
}

/** Test hook: behave as if `import("keytar")` returned `mod` (or threw `loadError`). */
export function simulateKeytarImportForTests(result: { mod?: unknown; loadError?: Error }): void {
  resetKeytarCacheForTests();
  keytarChecked = true;
  if (result.loadError) {
    keytarUnavailableReason = result.loadError.message;
    return;
  }
  keytarModule = resolveKeytarModule(result.mod);
  if (!keytarModule) keytarIncompatible = incompatibleKeytarError();
}
