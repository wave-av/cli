import { Command } from "commander";
import chalk from "chalk";
import { writeFile, mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { wrapCommand } from "../../lib/errors.js";
import { getClient } from "../../lib/api-client.js";
import { promptSelect, promptInput } from "../../lib/prompts.js";
import { withSpinner } from "../../lib/output/spinner.js";
import { loadConfig, updateConfig } from "../../lib/config/manager.js";
import { getApiKey } from "../../lib/auth/keychain.js";
import type { PaginatedResponse } from "@wave-av/sdk";

interface Organization {
  id: string;
  name: string;
}

interface Project {
  id: string;
  name: string;
}

interface ProjectLinkConfig {
  projectId: string;
  organizationId: string;
  projectName: string;
}

const CREATE_NEW_PROJECT_VALUE = "__create_new__";

export function registerLinkCommands(program: Command): void {
  program
    .command("link")
    .description("Link the current directory to a WAVE project")
    .option("--org <id>", "Organization ID (skip org selection prompt)")
    .option("--project <id>", "Project ID (skip project selection prompt)")
    .action(
      wrapCommand(async (opts) => {
        // 1. Verify authentication
        const config = await loadConfig();
        const configProjectName = config.currentProject || "default";
        const apiKey = await getApiKey(configProjectName);

        if (!apiKey) {
          console.error(
            chalk.red(
              `Not authenticated. Run ${chalk.bold("wave auth login")} first.`,
            ),
          );
          process.exit(1);
        }

        const wave = await getClient({ org: opts.org });

        // 2. Fetch organizations via the SDK's underlying HTTP client
        const orgs = await withSpinner("Fetching organizations...", async () => {
          const response = await wave.client.get<PaginatedResponse<Organization>>(
            "/v1/organizations",
          );
          return response.data;
        });

        if (!orgs || orgs.length === 0) {
          console.error(
            chalk.red(
              "No organizations found. Create one at https://wave.online/dashboard/settings/organizations",
            ),
          );
          process.exit(1);
        }

        // 3. Select organization
        let selectedOrg: Organization;
        if (opts.org) {
          const match = orgs.find((o) => o.id === opts.org);
          if (!match) {
            console.error(
              chalk.red(
                `Organization "${opts.org}" not found. Available organizations:\n` +
                  orgs.map((o) => `  ${o.name} (${o.id})`).join("\n"),
              ),
            );
            process.exit(1);
          }
          selectedOrg = match;
        } else {
          const orgId = await promptSelect(
            "Select organization:",
            orgs.map((o) => ({
              name: `${o.name} (${o.id})`,
              value: o.id,
            })),
          );
          selectedOrg = orgs.find((o) => o.id === orgId)!;
        }

        // 4. Fetch projects for the selected organization
        const projects = await withSpinner("Fetching projects...", async () => {
          const response = await wave.client.get<PaginatedResponse<Project>>(
            "/v1/projects",
            {
              params: { organization_id: selectedOrg.id },
            },
          );
          return response.data;
        });

        // 5. Select or create project
        let selectedProject: Project;
        if (opts.project) {
          const match = projects?.find((p) => p.id === opts.project);
          if (!match) {
            console.error(
              chalk.red(
                `Project "${opts.project}" not found in organization "${selectedOrg.name}".`,
              ),
            );
            process.exit(1);
          }
          selectedProject = match;
        } else {
          const choices = [
            ...(projects ?? []).map((p) => ({
              name: `${p.name} (${p.id})`,
              value: p.id,
            })),
            {
              name: chalk.green("+ Create new project"),
              value: CREATE_NEW_PROJECT_VALUE,
            },
          ];

          const projectId = await promptSelect("Select project:", choices);

          if (projectId === CREATE_NEW_PROJECT_VALUE) {
            const newName = await promptInput("Project name:");
            selectedProject = await withSpinner(
              "Creating project...",
              async () => {
                return wave.client.post<Project>("/v1/projects", {
                  organization_id: selectedOrg.id,
                  name: newName,
                });
              },
            );
          } else {
            selectedProject = projects!.find((p) => p.id === projectId)!;
          }
        }

        // 6. Write .wave/project.json
        const cwd = resolve(process.cwd());
        const waveDirPath = join(cwd, ".wave");
        const projectJsonPath = join(waveDirPath, "project.json");

        if (!existsSync(waveDirPath)) {
          await mkdir(waveDirPath, { recursive: true });
        }

        const linkConfig: ProjectLinkConfig = {
          projectId: selectedProject.id,
          organizationId: selectedOrg.id,
          projectName: selectedProject.name,
        };

        await writeFile(
          projectJsonPath,
          JSON.stringify(linkConfig, null, 2) + "\n",
          "utf-8",
        );

        // 7. Add .wave/ to .gitignore if not already present
        const gitignorePath = join(cwd, ".gitignore");
        await ensureGitignoreEntry(gitignorePath, ".wave/");

        // 8. Update CLI config with the linked project context
        await updateConfig((cfg) => ({
          ...cfg,
          projects: {
            ...cfg.projects,
            [configProjectName]: {
              ...cfg.projects[configProjectName],
              organizationId: selectedOrg.id,
              organizationName: selectedOrg.name,
            },
          },
        }));

        console.log("");
        console.log(
          chalk.green(
            `Linked to "${selectedProject.name}" (${selectedProject.id})`,
          ),
        );
        console.log(chalk.dim(`Created ${projectJsonPath}`));
        console.log("");
      }),
    );
}

async function ensureGitignoreEntry(
  gitignorePath: string,
  entry: string,
): Promise<void> {
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
