import { refreshAgentCeremony } from "@wave-av/sdk";
import { loadConfig, updateConfig } from "../config/manager.js";
import { ConfigError, KeychainTimeoutError } from "../errors.js";
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

/** localhost, the IPv6 loopback, and 127.0.0.0/8 (URL.hostname keeps IPv6 brackets). */
function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Validate an API base URL before any credential is sent to it. The CLI sends a bearer API key or
 * device-flow token (and, on refresh, the refresh token) to this host, so it must be https://.
 * Plain http:// is accepted only for a loopback host (a gateway running locally), where nothing
 * crosses the network. `origin` names where the value came from, for the error message.
 */
export function validateApiBaseUrl(raw: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${origin} is not a valid URL: ${JSON.stringify(raw)}`);
  }
  const loopbackHttp = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new ConfigError(
      `Refusing to send WAVE credentials to ${url.protocol}//${url.host}: ${origin} must use ` +
        "https:// (http:// is accepted only for localhost).",
    );
  }
  if (url.username || url.password) {
    throw new ConfigError(`${origin} must not embed a username or password.`);
  }
  return raw.replace(/\/+$/, "");
}

/** API base URL: WAVE_BASE_URL, then the project's saved baseUrl, then api.wave.online. */
export function resolveBaseUrl(config: WaveConfig, project: string): string {
  const env = process.env["WAVE_BASE_URL"];
  if (env) return validateApiBaseUrl(env, "WAVE_BASE_URL");
  const saved = config.projects[project]?.baseUrl;
  if (saved) return validateApiBaseUrl(saved, `The saved baseUrl of project "${project}"`);
  return DEFAULT_API_BASE_URL;
}

/**
 * The ONE place every command resolves "which key, which host, which org". Key order:
 *   1. WAVE_API_KEY (CI/CD and agents; documented in the README)
 *   2. the key `wave auth login` stored for the project (keychain, or the file fallback)
 * Organization order: the global `--org` flag, then WAVE_ORG_ID, then the project's saved org.
 * The most specific source wins, as for --project over WAVE_PROJECT.
 *
 * 1.0.10 had four different answers to this question: getClient() honored WAVE_API_KEY, while
 * whoami / auth status / status / billing / admin / api / logs read the keychain only, so a CI
 * user with WAVE_API_KEY set was told "Not authenticated" by half the CLI.
 *
 * Returns null when no credential exists; callers decide how to report that.
 */
export async function resolveCredentials(opts?: {
  project?: string;
  org?: string;
}): Promise<ResolvedCredentials | null> {
  const config = await loadConfig();
  const project = resolveProjectName(config, opts?.project);
  const baseUrl = resolveBaseUrl(config, project);
  const organizationId =
    opts?.org || process.env["WAVE_ORG_ID"] || config.projects[project]?.organizationId || undefined;

  const envKey = process.env["WAVE_API_KEY"];
  if (envKey) {
    return { apiKey: envKey, source: "env", project, baseUrl, organizationId };
  }

  let apiKey = await getApiKey(project);
  if (!apiKey) return null;

  const expiresAt = config.projects[project]?.tokenExpiresAt;
  if (expiresAt !== undefined && Date.now() >= expiresAt - REFRESH_SKEW_MS) {
    apiKey = await refreshDeviceToken(project, baseUrl, apiKey, expiresAt);
  }

  return { apiKey, source: "stored", project, baseUrl, organizationId };
}

/**
 * The token endpoint refused the refresh token (RFC 6749 invalid_grant and friends answer 400/401;
 * 403 is a refusal too). Anything else (no status: a transport failure; 5xx; 429) is not a verdict
 * on the token.
 */
function isRefreshRefused(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number };
  const status = e?.statusCode ?? e?.status;
  return status === 400 || status === 401 || status === 403;
}

function describe(err: unknown): string {
  const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = e?.statusCode ?? e?.status;
  return [status ? String(status) : "", e?.code ?? "", e?.message ?? String(err)].filter(Boolean).join(" ");
}

/**
 * Rotate an expiring device-flow access token with its refresh token, and return the token to use.
 *
 *   - No refresh token, or the server refused it: the current token is returned and sent as-is.
 *     The gateway's 401 then tells the user to log in again (exit 2).
 *   - The refresh could not be attempted (network, 5xx): the current token is used while it is
 *     still inside its lifetime (the refresh runs 60s early); past expiry the failure is reported.
 *   - The refresh succeeded but could not be saved: reported, never swallowed. Returning the new
 *     token would leave the store holding a token the server may already have rotated away.
 *
 * On success the rotated refresh token is saved first (the server may have invalidated the old
 * one, so losing it would force a new login), then the access token, then its expiry. A failure
 * after the first write leaves a state the next command repairs by refreshing again.
 */
async function refreshDeviceToken(
  project: string,
  baseUrl: string,
  current: string,
  expiresAt: number,
): Promise<string> {
  const refreshToken = await getRefreshToken(project);
  if (!refreshToken) return current;

  let tokens: Awaited<ReturnType<typeof refreshAgentCeremony>>;
  try {
    tokens = await refreshAgentCeremony(refreshToken, { baseUrl });
  } catch (err) {
    if (isRefreshRefused(err)) return current;
    if (Date.now() < expiresAt) return current;
    throw new Error(
      `Your device-login token expired and could not be refreshed (${describe(err)}). Check your ` +
        "connection and retry, or run `wave auth login` again.",
    );
  }

  try {
    if (tokens.refresh_token) await storeRefreshToken(project, tokens.refresh_token);
    await storeApiKey(project, tokens.access_token);
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
  } catch (err) {
    if (err instanceof KeychainTimeoutError) throw err;
    throw new Error(
      "Your device-login token was refreshed, but saving it failed " +
        `(${err instanceof Error ? err.message : String(err)}). Fix the credential store and run ` +
        "`wave auth login` again.",
    );
  }
  return tokens.access_token;
}
