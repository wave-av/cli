/**
 * RFC 8628 Device Authorization Flow
 *
 * Implements the device authorization grant for CLI authentication.
 * The user is presented with a code and URL, authenticates in-browser,
 * and the CLI polls until the token is available.
 */

import open from "open";
import chalk from "chalk";
import type { DeviceAuthResponse, TokenResponse } from "../../types/index.js";

/** Error codes returned by the device token endpoint */
const POLL_ERROR_AUTHORIZATION_PENDING = "authorization_pending";
const POLL_ERROR_SLOW_DOWN = "slow_down";
const POLL_ERROR_EXPIRED_TOKEN = "expired_token";
const POLL_ERROR_ACCESS_DENIED = "access_denied";

/** Additional interval (ms) added when the server requests slow_down */
const SLOW_DOWN_INCREMENT_MS = 5000;

interface DeviceTokenErrorResponse {
  error: string;
  error_description?: string;
}

/**
 * Initiates the device authorization flow by requesting a device code
 * and user code from the authorization server.
 */
export async function startDeviceAuth(baseUrl: string): Promise<DeviceAuthResponse> {
  const url = `${baseUrl}/api/oauth/device/authorize`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: "wave-cli",
      scope: "openid profile email offline_access",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Device authorization request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as DeviceAuthResponse;

  // Display the user code prominently
  console.log();
  console.log(chalk.bold("  Open this URL in your browser to authenticate:"));
  console.log();
  console.log(`    ${chalk.cyan.underline(data.verification_uri)}`);
  console.log();
  console.log(chalk.bold("  Enter this code when prompted:"));
  console.log();
  console.log(`    ${chalk.bold.yellow(data.user_code)}`);
  console.log();

  // Attempt to open the browser automatically
  const verificationUrl = data.verification_uri_complete ?? data.verification_uri;
  try {
    await open(verificationUrl);
    console.log(chalk.gray("  Browser opened automatically."));
  } catch {
    console.log(
      chalk.gray("  Could not open browser automatically. Please open the URL manually."),
    );
  }

  console.log();
  console.log(chalk.gray("  Waiting for authentication..."));
  console.log();

  return data;
}

/**
 * Polls the token endpoint until the user completes authentication,
 * the code expires, or the user denies access.
 *
 * Handles the following error responses per RFC 8628:
 * - authorization_pending: continue polling
 * - slow_down: increase interval by 5 seconds and continue
 * - expired_token: throw (user took too long)
 * - access_denied: throw (user denied access)
 */
export async function pollForToken(
  baseUrl: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<TokenResponse> {
  const url = `${baseUrl}/api/oauth/device/token`;
  const deadline = Date.now() + expiresIn * 1000;
  let pollIntervalMs = interval * 1000;

  while (Date.now() < deadline) {
    // Wait the required interval before polling
    await sleep(pollIntervalMs);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: "wave-cli",
      }),
    });

    // Successful token response
    if (response.ok) {
      const tokenData = (await response.json()) as TokenResponse;
      console.log(chalk.green("  Authentication successful."));
      return tokenData;
    }

    // Parse the error response
    const errorBody = (await response.json()) as DeviceTokenErrorResponse;
    const errorCode = errorBody.error;

    switch (errorCode) {
      case POLL_ERROR_AUTHORIZATION_PENDING:
        // User hasn't completed auth yet, keep polling
        break;

      case POLL_ERROR_SLOW_DOWN:
        // Server requested we slow down
        pollIntervalMs += SLOW_DOWN_INCREMENT_MS;
        break;

      case POLL_ERROR_EXPIRED_TOKEN:
        throw new Error("Device code has expired. Please run the login command again.");

      case POLL_ERROR_ACCESS_DENIED:
        throw new Error("Authentication was denied. Please try again.");

      default:
        throw new Error(
          `Unexpected error during device flow: ${errorCode}${
            errorBody.error_description ? ` - ${errorBody.error_description}` : ""
          }`,
        );
    }
  }

  throw new Error("Device code has expired (timeout). Please run the login command again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
