const SERVICE_NAME = "wave-cli";

interface KeytarLike {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

let keytarModule: KeytarLike | null = null;
let keytarChecked = false;

async function getKeytar(): Promise<KeytarLike | null> {
  if (keytarChecked) return keytarModule;
  keytarChecked = true;
  try {
    keytarModule = (await import(
      /* webpackIgnore: true */ "keytar" as string
    )) as unknown as KeytarLike;
    return keytarModule;
  } catch {
    return null;
  }
}

export async function storeApiKey(project: string, key: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.setPassword(SERVICE_NAME, `apikey:${project}`, key);
  } else {
    await storeToFile(project, key);
  }
}

export async function getApiKey(project: string): Promise<string | null> {
  const keytar = await getKeytar();
  if (keytar) {
    return keytar.getPassword(SERVICE_NAME, `apikey:${project}`);
  }
  return getFromFile(project);
}

export async function deleteApiKey(project: string): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    await keytar.deletePassword(SERVICE_NAME, `apikey:${project}`);
  } else {
    await deleteFromFile(project);
  }
}

export async function deleteAllKeys(): Promise<void> {
  const keytar = await getKeytar();
  if (keytar) {
    const credentials = await keytar.findCredentials(SERVICE_NAME);
    for (const cred of credentials) {
      await keytar.deletePassword(SERVICE_NAME, cred.account);
    }
  } else {
    await deleteAllFromFile();
  }
}

// File-based fallback when keytar is not available
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CRED_FILE = join(homedir(), ".wave", "credentials.json");

async function loadCredentials(): Promise<Record<string, string>> {
  try {
    if (!existsSync(CRED_FILE)) return {};
    const raw = await readFile(CRED_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function saveCredentials(creds: Record<string, string>): Promise<void> {
  const dir = join(homedir(), ".wave");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CRED_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

async function storeToFile(project: string, key: string): Promise<void> {
  const creds = await loadCredentials();
  creds[project] = key;
  await saveCredentials(creds);
}

async function getFromFile(project: string): Promise<string | null> {
  const creds = await loadCredentials();
  return creds[project] ?? null;
}

async function deleteFromFile(project: string): Promise<void> {
  const creds = await loadCredentials();
  delete creds[project];
  await saveCredentials(creds);
}

async function deleteAllFromFile(): Promise<void> {
  await saveCredentials({});
}
