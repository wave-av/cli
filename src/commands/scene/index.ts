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
          media_id: opts.recordingId,
          media_type: "recording",
        });
        console.log(chalk.green("Scene detection started."));
        formatOutput(result, program.opts());
      }),
    );

  scene
    .command("list")
    .description("List scene detections for a recording")
    .requiredOption("--recording-id <recordingId>", "Recording ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.scene.listDetections({
          media_id: opts.recordingId,
        });
        formatOutput(result.data, program.opts());
      }),
    );

  scene
    .command("compare")
    .description("Compare the scenes of two detections")
    .requiredOption("--source-detection-id <id>", "Source scene-detection ID")
    .requiredOption("--target-detection-id <id>", "Target scene-detection ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Comparison is pairwise across two DETECTIONS, not an N-way compare
        // across recording IDs.
        const result = await client.scene.compareScenes(
          opts.sourceDetectionId,
          opts.targetDetectionId,
        );
        formatOutput(result, program.opts());
      }),
    );
}
