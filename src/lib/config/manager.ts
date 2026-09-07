import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WaveConfig } from "../../types/index.js";
import { waveConfigSchema, getDefaultConfig } from "./schema.js";

const CONFIG_DIR = join(homedir(), ".wave");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function getConfigDir(): string {
  return CONFIG_DIR;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export async function loadConfig(): Promise<WaveConfig> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      const defaults = getDefaultConfig();
      await saveConfig(defaults);
      return defaults;
    }
    const raw = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return waveConfigSchema.parse(parsed);
  } catch {
    const defaults = getDefaultConfig();
    await saveConfig(defaults);
    return defaults;
  }
}

export async function saveConfig(config: WaveConfig): Promise<void> {
  const validated = waveConfigSchema.parse(config);
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
  }
  const tmpPath = `${CONFIG_FILE}.tmp`;
  await writeFile(tmpPath, JSON.stringify(validated, null, 2) + "\n", "utf-8");
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, CONFIG_FILE);
}

export async function updateConfig(
  updater: (config: WaveConfig) => WaveConfig,
): Promise<WaveConfig> {
  const current = await loadConfig();
  const updated = updater(current);
  await saveConfig(updated);
  return updated;
}
