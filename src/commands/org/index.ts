import { Command } from "commander";
import chalk from "chalk";
import { wrapCommand } from "../../lib/errors.js";
import { formatOutput } from "../../lib/output/index.js";
import { loadConfig, updateConfig } from "../../lib/config/manager.js";

export function registerOrgCommands(program: Command): void {
  const org = program.command("org").description("Manage organizations");

  org
    .command("list")
    .description("List available organizations")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const orgs = Object.entries(config.projects).map(([name, project]) => ({
          name,
          organizationId: project.organizationId,
          organizationName: project.organizationName,
          current: name === config.currentProject ? "*" : "",
        }));
        formatOutput(orgs, program.opts());
      }),
    );

  org
    .command("switch <id>")
    .description("Switch to a different organization")
    .action(
      wrapCommand(async (id: string) => {
        const config = await loadConfig();
        const match = Object.entries(config.projects).find(
          ([name, project]) => name === id || project.organizationId === id,
        );

        if (!match) {
          throw new Error(
            `Organization "${id}" not found. Run ${chalk.bold("wave org list")} to see available organizations.`,
          );
        }

        const [projectName] = match;
        await updateConfig((cfg) => ({
          ...cfg,
          currentProject: projectName,
        }));
        console.log(chalk.green(`Switched to organization "${projectName}".`));
      }),
    );

  org
    .command("current")
    .description("Show the current organization")
    .action(
      wrapCommand(async () => {
        const config = await loadConfig();
        const project = config.projects[config.currentProject];
        if (!project) {
          console.log(chalk.yellow("No organization configured. Run `wave login` first."));
          return;
        }
        formatOutput(
          {
            project: config.currentProject,
            organizationId: project.organizationId,
            organizationName: project.organizationName,
            region: project.region ?? "auto",
          },
          program.opts(),
        );
      }),
    );
}
