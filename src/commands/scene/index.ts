import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerSceneCommands(program: Command): void {
  const scene = program.command("scene").description("Scene detection and analysis");

  scene
    .command("detect")
    .description("Detect scenes in a recording")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.scene.detect({
          recordingId: opts.recordingId,
        });
        console.log(chalk.green("Scene detection started."));
        formatOutput(result, program.opts());
      }),
    );

  scene
    .command("list")
    .description("List detected scenes")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.scene.list({
          recordingId: opts.recordingId,
        });
        formatOutput(result.data, program.opts());
      }),
    );

  scene
    .command("compare")
    .description("Compare scenes across recordings")
    .requiredOption("--recording-ids <ids>", "Comma-separated recording IDs")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const recordingIds = (opts.recordingIds as string).split(",");
        const result = await client.scene.compare({ recordingIds });
        formatOutput(result, program.opts());
      }),
    );
}
