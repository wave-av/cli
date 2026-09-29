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
import {
  startAgentCeremony,
  pollAgentCeremony,
  isCeremonyPending,
  type CeremonyTokens,
  type DeviceGrant,
} from "@wave-av/sdk";

/** Additional interval (ms) added when the server requests slow_down */
const SLOW_DOWN_INCREMENT_MS = 5000;

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

function describeError(err: unknown): string {
  const e = err as { status?: number; code?: string; message?: string };
  const parts = [e.status ? `${e.status}` : "", e.code ?? "", e.message ?? String(err)].filter(Boolean);
  return parts.join(" ");
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
    throw new Error(`Device authorization request failed: ${describeError(err)}`);
  }

  log("");
  log(chalk.bold("  Open this URL in your browser to authenticate:"));
  log("");
  log(`    ${chalk.cyan.underline(data.verification_uri)}`);
  log("");
  log(chalk.bold("  Enter this code when prompted:"));
  log("");
  log(`    ${chalk.bold.yellow(data.user_code)}`);
  log("");

  if (options.openBrowser !== false) {
    const verificationUrl = data.verification_uri_complete ?? data.verification_uri;
    try {
      await open(verificationUrl);
      log(chalk.gray("  Browser opened automatically."));
    } catch {
      log(chalk.gray("  Could not open browser automatically. Please open the URL manually."));
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
  const deadline = Date.now() + expiresIn * 1000;
  let pollIntervalMs = Math.max(1, interval) * 1000;

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
      throw new Error(`Unexpected error during device flow: ${describeError(err)}`);
    }
  }

  throw new Error("Device code has expired (timeout). Please run `wave auth login` again.");
}
