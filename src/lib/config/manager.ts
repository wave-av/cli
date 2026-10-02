import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WaveConfig } from "../../types/index.js";
import { ConfigError } from "../errors.js";
import { withFileLock, writeFileAtomic } from "../fs-lock.js";
import { waveConfigSchema, getDefaultConfig } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".wave");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

/**
 * Read ~/.wave/config.json. A missing (or empty) file means defaults, and nothing is written: a
 * read never creates files, so read-only commands work under a read-only HOME.
 *
 * An unreadable or malformed file is an error, never a reset. Earlier versions caught every
 * failure here and saved the defaults over the file, so one bad edit (or a config written by a
 * newer CLI) silently erased every saved project. With WAVE_API_KEY-driven credential resolution
 * reading the config on every command, that would have wiped configs in CI too.
 */
export async function loadConfig(): Promise<WaveConfig> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_FILE, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return getDefaultConfig();
    throw new ConfigError(`Cannot read ${CONFIG_FILE}: ${(err as Error).message}`);
  }
  if (!raw.trim()) return getDefaultConfig();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(
      `${CONFIG_FILE} is not valid JSON (${(err as Error).message}). Fix it or move it aside; ` +
        "the CLI will not overwrite it.",
    );
  }
  const result = waveConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ConfigError(
      `${CONFIG_FILE} does not match the expected format (${issues}). Fix it or move it aside; ` +
        "the CLI will not overwrite it.",
    );
  }
  return result.data;
}

export async function saveConfig(config: WaveConfig): Promise<void> {
  const validated = waveConfigSchema.parse(config);
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  await writeFileAtomic(CONFIG_FILE, JSON.stringify(validated, null, 2) + "\n");
}

/**
 * Read-modify-write under the config lock, so two `wave` processes updating different projects
 * (a token refresh and a login, say) cannot overwrite each other's change.
 */
export async function updateConfig(
  updater: (config: WaveConfig) => WaveConfig,
): Promise<WaveConfig> {
  return withFileLock(CONFIG_FILE, async () => {
    const current = await loadConfig();
    const updated = updater(current);
    await saveConfig(updated);
    return updated;
  });
}
