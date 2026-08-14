import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerEditorCommands(program: Command): void {
  const editor = program.command("editor").description("Manage video editor projects");

  editor
    .command("create")
    .description("Create a new editor project")
    .requiredOption("--title <title>", "Project title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.editor.create({ title: opts.title });
        console.log(chalk.green(`Editor project created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  editor
    .command("list")
    .description("List editor projects")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.editor.list({ limit: parseInt(opts.limit) });
        formatOutput(result.data, program.opts());
      }),
    );

  editor
    .command("get <id>")
    .description("Get editor project details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.editor.get(id);
        formatOutput(result, program.opts());
      }),
    );

  editor
    .command("render <id>")
    .description("Render an editor project")
    .option("--format <format>", "Output format (mp4, webm, mov)", "mp4")
    .action(
      wrapCommand(async (id: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.editor.render(id, { format: opts.format });
        console.log(chalk.green(`Render started for project ${id}.`));
        formatOutput(result, program.opts());
      }),
    );
}
