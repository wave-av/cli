import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { WaveError } from "@wave-av/sdk";
import { AuthRequiredError, wrapCommand } from "../../lib/errors.js";
import { updateConfig } from "../../lib/config/manager.js";
import { resolveCredentials, type ResolvedCredentials } from "../../lib/auth/credentials.js";
import { gatewayFetch } from "../../lib/gateway.js";

interface ProjectLinkConfig {
  organizationId: string;
  projectName: string;
  linkedAt: string;
}

/**
 * Served routes that report the organization an API key belongs to, tried in order. A key may
 * lack one route's scope (403) and hold another's, so a 403 moves on to the next route; any other
 * failure is real and propagates.
 *
 * 1.0.10 listed organizations and projects via GET /v1/organizations (404 ROUTE_NOT_FOUND) and
 * GET/POST /v1/projects (404 ROUTE_NOT_MAPPED). Neither is served, and the gateway resolves the org
 * from the key itself, so `link` now records the key's org instead of offering a list it cannot get.
 */
const ORG_SOURCES: Array<{ path: string; field: "organizationId" | "org" }> = [
  { path: "/v1/billing", field: "organizationId" },
  { path: "/v1/analytics/overview", field: "organizationId" },
  { path: "/v1/webhook-subscriptions", field: "org" },
];

export async function discoverOrganizationId(credentials: ResolvedCredentials): Promise<string | null> {
  for (const source of ORG_SOURCES) {
    try {
      const body = await gatewayFetch<Record<string, unknown>>(source.path, { credentials });
      const value = body?.[source.field];
      if (typeof value === "string" && value) return value;
    } catch (err) {
      if (err instanceof WaveError && err.statusCode === 403) continue;
      throw err;
    }
  }
  return null;
}

export function registerLinkCommands(program: Command): void {
  program
    .command("link")
    .description("Link the current directory to your WAVE organization")
    .option("--org <id>", "Expected organization ID (fails if the key belongs to another org)")
    .option("--name <name>", "Local project name (default: the directory name)")
    .action(
      wrapCommand(async (opts: { org?: string; name?: string }) => {
        // 1. Verify authentication (WAVE_API_KEY or a stored key). 1.0.10 printed "Not
        // authenticated" and still exited 0.
        const credentials = await resolveCredentials({ project: program.opts().project });
        if (!credentials) {
          throw new AuthRequiredError();
        }

        // 2. Which org does this key act for? Ask without the saved/env org header: after a key
        // change, the cached org is exactly what this command exists to replace.
        const organizationId = await discoverOrganizationId({ ...credentials, organizationId: undefined });
        if (!organizationId) {
          throw new Error(
            "Could not determine your organization: this key can read none of /v1/billing, " +
              "/v1/analytics/overview, /v1/webhook-subscriptions. Pass a key with billing:read.",
          );
        }
        // `--org` is also a global flag; commander gives it to the program when both define it.
        const expectedOrg = opts.org ?? (program.opts().org as string | undefined);
        if (expectedOrg && expectedOrg !== organizationId) {
          throw new Error(
            `This API key belongs to organization ${organizationId}, not ${expectedOrg}. ` +
              "Log in with a key for that organization (`wave auth login --api-key ...`).",
          );
        }

        // 3. Write .wave/project.json
        const cwd = resolve(process.cwd());
        const waveDirPath = join(cwd, ".wave");
        const projectJsonPath = join(waveDirPath, "project.json");

        if (!existsSync(waveDirPath)) {
          await mkdir(waveDirPath, { recursive: true });
        }

        const linkConfig: ProjectLinkConfig = {
          organizationId,
          projectName: opts.name ?? basename(cwd),
          linkedAt: new Date().toISOString(),
        };

        await writeFile(projectJsonPath, JSON.stringify(linkConfig, null, 2) + "\n", "utf-8");

        // 4. Add .wave/ to .gitignore if not already present
        await ensureGitignoreEntry(join(cwd, ".gitignore"), ".wave/");

        // 5. Remember the org on the CLI project entry the key belongs to
        await updateConfig((cfg) => ({
          ...cfg,
          projects: {
            ...cfg.projects,
            [credentials.project]: {
              ...cfg.projects[credentials.project],
              organizationId,
            },
          },
        }));

        console.log("");
        console.log(chalk.green(`Linked "${linkConfig.projectName}" to organization ${organizationId}`));
        console.log(chalk.dim(`Created ${projectJsonPath}`));
        console.log("");
      }),
    );
}

async function ensureGitignoreEntry(gitignorePath: string, entry: string): Promise<void> {
  if (existsSync(gitignorePath)) {
    const content = await readFile(gitignorePath, "utf-8");
    const lines = content.split("\n").map((l) => l.trim());
    if (lines.includes(entry)) {
      return;
    }
    // Append with a newline separator if file doesn't end with one
    const separator = content.endsWith("\n") ? "" : "\n";
    await appendFile(gitignorePath, `${separator}${entry}\n`, "utf-8");
  } else {
    await writeFile(gitignorePath, `${entry}\n`, "utf-8");
  }
}
