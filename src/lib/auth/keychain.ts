import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
 * never used: the caller falls back to the credentials file instead of crashing.
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

/**
 * `WAVE_CREDENTIAL_STORE=file` forces the ~/.wave/credentials.json store (headless Linux without
 * libsecret, containers, CI runners, tests). Anything else uses the OS keychain when available.
 */
function fileStoreForced(): boolean {
  return (process.env["WAVE_CREDENTIAL_STORE"] ?? "").toLowerCase() === "file";
}

async function getKeytar(): Promise<KeytarLike | null> {
  if (fileStoreForced()) return null;
  if (keytarChecked) return keytarModule;
  keytarChecked = true;
  try {
    const mod: unknown = await import(/* webpackIgnore: true */ "keytar" as string);
    keytarModule = resolveKeytarModule(mod);
  } catch {
    keytarModule = null;
  }
  return keytarModule;
}

/** Which backend credentials are read from and written to on this machine right now. */
export async function credentialBackend(): Promise<"keychain" | "file"> {
  return (await getKeytar()) ? "keychain" : "file";
}

async function setSecret(account: string, value: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, account, value);
    return;
  }
  const creds = await loadCredentials();
  creds[account] = value;
  await saveCredentials(creds);
}

async function getSecret(account: string): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    return keytar.getPassword(SERVICE_NAME, account);
  }
  const creds = await loadCredentials();
  return creds[account] ?? null;
}

async function deleteSecret(account: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, account);
    return;
  }
  const creds = await loadCredentials();
  if (!(account in creds)) return;
  delete creds[account];
  await saveCredentials(creds);
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
    const credentials = await keytar.findCredentials(SERVICE_NAME);
    for (const cred of credentials) {
      await keytar.deletePassword(SERVICE_NAME, cred.account);
    }
    return;
  }
  await saveCredentials({});
}

// File store, used when keytar is unavailable or WAVE_CREDENTIAL_STORE=file. Entries use the same
// account names as the keychain ("apikey:<project>", "refresh:<project>").

function credentialsDir(): string {
  return join(homedir(), ".wave");
}

function credentialsFile(): string {
  return join(credentialsDir(), "credentials.json");
}

async function loadCredentials(): Promise<Record<string, string>> {
  try {
    const file = credentialsFile();
    if (!existsSync(file)) return {};
    const parsed = JSON.parse(await readFile(file, "utf-8")) as Record<string, string>;
    // 1.0.10 and earlier keyed file entries by bare project name: read those as API keys.
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      normalized[k.includes(":") ? k : `apikey:${k}`] = v;
    }
    return normalized;
  } catch {
    return {};
  }
}

async function saveCredentials(creds: Record<string, string>): Promise<void> {
  const dir = credentialsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  const file = credentialsFile();
  await writeFile(file, JSON.stringify(creds, null, 2), { mode: 0o600 });
  // writeFile's mode only applies when it creates the file; enforce it on an existing one too.
  await chmod(file, 0o600);
}

/** Test hook: forget the cached keytar lookup so the next call resolves it again. */
export function resetKeytarCacheForTests(): void {
  keytarModule = null;
  keytarChecked = false;
}
