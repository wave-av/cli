import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerStudioCommands(program: Command): void {
  const studio = program.command("studio").description("Manage studio productions");

  studio
    .command("create")
    .description("Create a new studio production")
    .requiredOption("--title <title>", "Production title")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studio.create({ title: opts.title });
        console.log(chalk.green(`Studio production created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  studio
    .command("list")
    .description("List studio productions")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studio.list({ limit: parseInt(opts.limit) });
        formatOutput(result.data, program.opts());
      }),
    );

  studio
    .command("get <id>")
    .description("Get studio production details")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.get(id);
        formatOutput(result, program.opts());
      }),
    );

  studio
    .command("start <id>")
    .description("Start a studio production")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.start(id);
        console.log(chalk.green(`Studio production ${id} started.`));
        formatOutput(result, program.opts());
      }),
    );

  studio
    .command("stop <id>")
    .description("Stop a studio production")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.stop(id);
        console.log(chalk.green(`Studio production ${id} stopped.`));
        formatOutput(result, program.opts());
      }),
    );

  // Nested: scene commands
  const scene = studio.command("scene").description("Manage studio scenes");

  scene
    .command("list <productionId>")
    .description("List scenes in a production")
    .action(
      wrapCommand(async (productionId: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.listScenes(productionId);
        formatOutput(result, program.opts());
      }),
    );

  scene
    .command("create <productionId>")
    .description("Create a scene in a production")
    .requiredOption("--name <name>", "Scene name")
    .option(
      "--layout <layout>",
      "Scene layout (fullscreen, split_2, split_3, split_4, pip, side_by_side, grid_2x2, grid_3x3, custom)",
      "fullscreen",
    )
    .action(
      wrapCommand(async (productionId: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.studio.createScene(productionId, {
          name: opts.name,
          layout: oneOf("--layout", opts.layout, [
            "fullscreen",
            "split_2",
            "split_3",
            "split_4",
            "pip",
            "side_by_side",
            "grid_2x2",
            "grid_3x3",
            "custom",
          ]),
        });
        console.log(chalk.green(`Scene created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  scene
    .command("activate <productionId> <sceneId>")
    .description("Activate a scene in a production")
    .action(
      wrapCommand(async (productionId: string, sceneId: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.activateScene(productionId, sceneId);
        console.log(chalk.green(`Scene ${sceneId} activated.`));
        formatOutput(result, program.opts());
      }),
    );

  // Nested: source commands
  const source = studio.command("source").description("Manage studio sources");

  source
    .command("list <productionId>")
    .description("List sources in a production")
    .action(
      wrapCommand(async (productionId: string) => {
        const client = await getClient(program.opts());
        const result = await client.studio.listSources(productionId);
        formatOutput(result, program.opts());
      }),
    );

  source
    .command("add <productionId>")
    .description("Add a source to a production")
    .requiredOption(
      "--type <type>",
      "Source type (camera, ndi, screen_share, rtmp_input, srt_input, media_file, browser, color_bars)",
    )
    .requiredOption("--name <name>", "Source display name")
    .option("--url <url>", "Source URL, for the URL-backed source types")
    .action(
      wrapCommand(async (productionId: string, opts) => {
        const client = await getClient(program.opts());
        const result = await client.studio.addSource(productionId, {
          name: opts.name,
          type: oneOf("--type", opts.type, [
            "camera",
            "ndi",
            "screen_share",
            "rtmp_input",
            "srt_input",
            "media_file",
            "browser",
            "color_bars",
          ]),
          url: opts.url,
        });
        console.log(chalk.green(`Source added: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );
}
