import { Wave } from "@wave-av/sdk";
import chalk from "chalk";
import { loadConfig } from "./config/manager.js";
import { getApiKey } from "./auth/keychain.js";
import { CLI_VERSION } from "./version.js";

export async function getClient(opts?: { org?: string; project?: string }): Promise<Wave> {
  // Environment variable override (for CI/CD)
  const envApiKey = process.env["WAVE_API_KEY"];
  const envOrgId = process.env["WAVE_ORG_ID"];
  const envBaseUrl = process.env["WAVE_BASE_URL"];

  if (envApiKey) {
    return new Wave({
      apiKey: envApiKey,
      organizationId: envOrgId ?? opts?.org,
      baseUrl: envBaseUrl,
    });
  }

  const config = await loadConfig();
  const projectName = opts?.project ?? process.env["WAVE_PROJECT"] ?? config.currentProject;

  const project = config.projects[projectName];
  if (!project) {
    console.error(
      chalk.red(
        `No project "${projectName}" configured. Run ${chalk.bold("wave login")} to authenticate.`,
      ),
    );
    process.exit(1);
  }

  const apiKey = await getApiKey(projectName);
  if (!apiKey) {
    console.error(
      chalk.red(
        `No API key found for project "${projectName}". Run ${chalk.bold("wave login")} to authenticate.`,
      ),
    );
    process.exit(1);
  }

  const client = new Wave({
    apiKey,
    organizationId: opts?.org ?? project.organizationId,
    baseUrl: project.baseUrl,
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
