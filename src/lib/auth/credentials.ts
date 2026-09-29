import { refreshAgentCeremony } from "@wave-av/sdk";
import { loadConfig, updateConfig } from "../config/manager.js";
import { getApiKey, getRefreshToken, storeApiKey, storeRefreshToken } from "./keychain.js";
import type { WaveConfig } from "../../types/index.js";

/** The WAVE API host. Never the wave.online marketing site, which serves no /v1 routes. */
export const DEFAULT_API_BASE_URL = "https://api.wave.online";

/** Refresh a device-flow access token this long before it expires. */
const REFRESH_SKEW_MS = 60_000;

export interface ResolvedCredentials {
  apiKey: string;
  /** "env" = WAVE_API_KEY; "stored" = the OS keychain or the ~/.wave/credentials.json fallback. */
  source: "env" | "stored";
  project: string;
  baseUrl: string;
  organizationId?: string;
}

/** Project context: explicit override (--project), then WAVE_PROJECT, then config.currentProject. */
export function resolveProjectName(config: WaveConfig, override?: string): string {
  return override || process.env["WAVE_PROJECT"] || config.currentProject || "default";
}

/** API base URL: WAVE_BASE_URL, then the project's saved baseUrl, then api.wave.online. */
export function resolveBaseUrl(config: WaveConfig, project: string): string {
  const raw = process.env["WAVE_BASE_URL"] || config.projects[project]?.baseUrl || DEFAULT_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * The ONE place every command resolves "which key, which host". Order:
 *   1. WAVE_API_KEY (CI/CD and agents; documented in the README)
 *   2. the key `wave auth login` stored for the project (keychain, or the file fallback)
 *
 * 1.0.10 had four different answers to this question: getClient() honored WAVE_API_KEY, while
 * whoami / auth status / status / billing / admin / api / logs read the keychain only, so a CI
 * user with WAVE_API_KEY set was told "Not authenticated" by half the CLI.
 *
 * Returns null when no credential exists; callers decide how to report that.
 */
export async function resolveCredentials(opts?: { project?: string }): Promise<ResolvedCredentials | null> {
  const config = await loadConfig();
  const project = resolveProjectName(config, opts?.project);
  const baseUrl = resolveBaseUrl(config, project);
  const organizationId = process.env["WAVE_ORG_ID"] || config.projects[project]?.organizationId;

  const envKey = process.env["WAVE_API_KEY"];
  if (envKey) {
    return { apiKey: envKey, source: "env", project, baseUrl, organizationId };
  }

  let apiKey = await getApiKey(project);
  if (!apiKey) return null;

  const expiresAt = config.projects[project]?.tokenExpiresAt;
  if (expiresAt !== undefined && Date.now() >= expiresAt - REFRESH_SKEW_MS) {
    apiKey = (await refreshDeviceToken(project, baseUrl)) ?? apiKey;
  }

  return { apiKey, source: "stored", project, baseUrl, organizationId };
}

/**
 * Rotate an expired device-flow access token with its refresh token. Returns the new access token,
 * or null when there is nothing to refresh with or the refresh was refused (the stale token is then
 * sent as-is and the gateway's 401 tells the user to log in again).
 */
async function refreshDeviceToken(project: string, baseUrl: string): Promise<string | null> {
  const refreshToken = await getRefreshToken(project);
  if (!refreshToken) return null;
  try {
    const tokens = await refreshAgentCeremony(refreshToken, { baseUrl });
    await storeApiKey(project, tokens.access_token);
    if (tokens.refresh_token) await storeRefreshToken(project, tokens.refresh_token);
    await updateConfig((cfg) => ({
      ...cfg,
      projects: {
        ...cfg.projects,
        [project]: {
          ...cfg.projects[project],
          tokenExpiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined,
        },
      },
    }));
    return tokens.access_token;
  } catch {
    return null;
  }
}
