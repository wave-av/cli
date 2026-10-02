import { Wave } from "@wave-av/sdk";
import chalk from "chalk";
import { resolveCredentials } from "./auth/credentials.js";
import { AuthRequiredError } from "./errors.js";
import { CLI_VERSION } from "./version.js";

export async function getClient(opts?: { org?: string; project?: string }): Promise<Wave> {
  // Credential + host resolution is shared with every raw-fetch command (lib/auth/credentials.ts):
  // WAVE_API_KEY first, then the key `wave auth login` stored. A stored key with no saved project
  // entry is fine: the gateway resolves the org from the key, and the host defaults to the API.
  // 1.0.10 exited with 'No project "default" configured' here, so a freshly stored key was unusable.
  // Organization: --org, then WAVE_ORG_ID, then the project's saved org (resolved there too).
  const creds = await resolveCredentials({ project: opts?.project, org: opts?.org });
  if (!creds) {
    throw new AuthRequiredError();
  }

  const client = new Wave({
    apiKey: creds.apiKey,
    organizationId: creds.organizationId,
    baseUrl: creds.baseUrl,
    customHeaders: {
      "X-Wave-Source": "cli",
      "X-Wave-CLI-Version": CLI_VERSION,
    },
  });

  // Wire SDK events to CLI UI
  client.client.on("rate_limit.hit", (retryAfter: number) => {
    console.warn(chalk.yellow(`Rate limited. Retrying in ${retryAfter}ms...`));
  });

  client.client.on("request.retry", (_url: string, _method: string, attempt: number) => {
    console.warn(chalk.gray(`Retry ${attempt}/3...`));
  });

  return client;
}
