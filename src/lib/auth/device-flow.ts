/**
 * RFC 8628 Device Authorization Flow, against the gateway's agent-auth ceremony:
 *   POST {base}/v1/agent/auth/device  -> device_code, user_code, verification_uri(_complete)
 *   POST {base}/v1/agent/auth/token   -> access_token (+ refresh_token) once a person approves
 *
 * 1.0.10 called /api/oauth/device/authorize|token, which the gateway answers with 404
 * ROUTE_NOT_FOUND, so `wave auth login` (the README's "recommended" path) failed immediately.
 * The HTTP calls now go through @wave-av/sdk's ceremony functions (the same paths the OpenAPI spec
 * publishes as agentAuthDevice / agentAuthToken), so the CLI and SDK cannot drift apart again.
 */

import open from "open";
import chalk from "chalk";
import { sanitizeForTerminal } from "../terminal.js";
import {
  WaveError,
  startAgentCeremony,
  pollAgentCeremony,
  isCeremonyPending,
  type CeremonyTokens,
  type DeviceGrant,
} from "@wave-av/sdk";

/** Additional interval (ms) added when the server requests slow_down */
const SLOW_DOWN_INCREMENT_MS = 5000;
/** RFC 8628 §3.2: the polling interval a client uses when the grant does not give one. */
const DEFAULT_INTERVAL_S = 5;
/**
 * How long to poll a grant that arrives without a usable expires_in. The spec (agentAuthDevice)
 * requires the field; this only bounds the wait if a response ever omits it.
 */
const DEFAULT_EXPIRES_IN_S = 900;

const isPositiveFinite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export interface DeviceFlowOptions {
  /** Open the verification URL in a browser (default true). */
  openBrowser?: boolean;
  /** fetch implementation (tests inject a mock). */
  fetchImpl?: typeof fetch;
  /** sleep implementation (tests inject an instant one). */
  sleep?: (ms: number) => Promise<void>;
  /** Log sink (tests silence it). */
  log?: (line: string) => void;
}

type CeremonyErrorLike = { statusCode?: number; status?: number; code?: string; message?: string; requestId?: string };

function describeError(err: unknown): string {
  const e = (err ?? {}) as CeremonyErrorLike;
  const status = e.statusCode ?? e.status;
  const parts = [status ? `${status}` : "", e.code ?? "", e.message ?? String(err)].filter(Boolean);
  return parts.join(" ");
}

/**
 * Add context to a ceremony failure without losing what the exit code depends on. The SDK's
 * ceremony helpers throw an Error carrying `status` and `code` (a WaveError, with `statusCode`, in
 * newer SDKs); either becomes a WaveError here, so ROUTE_NOT_FOUND still exits 11 and a 401 exits 2.
 * A failure with no HTTP status (the network) stays a plain Error.
 */
function withContext(context: string, err: unknown): Error {
  const e = (err ?? {}) as CeremonyErrorLike;
  const status = e.statusCode ?? e.status;
  if (typeof status === "number") {
    return new WaveError(`${context}: ${describeError(err)}`, e.code ?? `HTTP_${status}`, status, e.requestId);
  }
  return new Error(`${context}: ${describeError(err)}`);
}

/** True when `url` is an http(s) URL on the same origin as `baseUrl` (the validated API host). */
export function isSameOriginWebUrl(url: string, baseUrl: string): boolean {
  try {
    const target = new URL(url);
    return (target.protocol === "https:" || target.protocol === "http:") && target.origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Requests a device code and user code, prints them, and (optionally) opens the browser.
 */
export async function startDeviceAuth(baseUrl: string, options: DeviceFlowOptions = {}): Promise<DeviceGrant> {
  const log = options.log ?? ((line: string) => console.log(line));

  let data: DeviceGrant;
  try {
    data = await startAgentCeremony({ baseUrl, fetchImpl: options.fetchImpl });
  } catch (err) {
    throw withContext("Device authorization request failed", err);
  }

  log("");
  log(chalk.bold("  Open this URL in your browser to authenticate:"));
  log("");
  log(`    ${chalk.cyan.underline(sanitizeForTerminal(data.verification_uri))}`);
  log("");
  log(chalk.bold("  Enter this code when prompted:"));
  log("");
  log(`    ${chalk.bold.yellow(sanitizeForTerminal(data.user_code))}`);
  log("");

  if (options.openBrowser !== false) {
    const verificationUrl = data.verification_uri_complete ?? data.verification_uri;
    // `open` hands the URL to the OS, which launches whatever handles its scheme: only a web page
    // on the API host's origin is opened automatically.
    if (!isSameOriginWebUrl(verificationUrl, baseUrl)) {
      log(chalk.yellow("  Not opening the verification URL automatically: it is not on the API host."));
    } else {
      try {
        await open(verificationUrl);
        log(chalk.gray("  Browser opened automatically."));
      } catch {
        log(chalk.gray("  Could not open browser automatically. Please open the URL manually."));
      }
    }
  }

  log("");
  log(chalk.gray("  Waiting for authentication..."));
  log("");

  return data;
}

/**
 * Polls the token endpoint until the user completes authentication, the code expires, or the
 * user denies access. Per RFC 8628: authorization_pending keeps polling, slow_down adds 5s to
 * the interval, expired_token and access_denied are terminal.
 */
export async function pollForToken(
  baseUrl: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
  options: DeviceFlowOptions = {},
): Promise<CeremonyTokens> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? ((line: string) => console.log(line));
  // RFC 8628 §3.2: `interval` is optional (default 5s). A missing or unusable value must not turn
  // into NaN: setTimeout(NaN) fires at once (a tight poll loop), and a NaN deadline ends the loop
  // before the first poll. `expires_in` is required, but the same guard costs nothing.
  const deadline = Date.now() + (isPositiveFinite(expiresIn) ? expiresIn : DEFAULT_EXPIRES_IN_S) * 1000;
  let pollIntervalMs = Math.max(1, isPositiveFinite(interval) ? interval : DEFAULT_INTERVAL_S) * 1000;

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);

    try {
      const tokens = await pollAgentCeremony(deviceCode, { baseUrl, fetchImpl: options.fetchImpl });
      log(chalk.green("  Authentication successful."));
      return tokens;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "slow_down") {
        pollIntervalMs += SLOW_DOWN_INCREMENT_MS;
        continue;
      }
      if (isCeremonyPending(err)) continue;
      if (code === "expired_token") {
        throw new Error("Device code has expired. Please run `wave auth login` again.");
      }
      if (code === "access_denied") {
        throw new Error("Authentication was denied. Please try again.");
      }
      throw withContext("Unexpected error during device flow", err);
    }
  }

  throw new Error("Device code has expired (timeout). Please run `wave auth login` again.");
}
