import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerPrismCommands(program: Command): void {
  const prism = program.command("prism").description("Camera discovery and PTZ control");

  prism
    .command("discover")
    .description("Discover available cameras on the network")
    .option("--timeout <ms>", "Discovery timeout in milliseconds", "5000")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.prism.discover({
          timeout: parseInt(opts.timeout),
        });
        formatOutput(result.data, program.opts());
      }),
    );

  prism
    .command("create")
    .description("Register a camera source")
    .requiredOption("--source-type <type>", "Source type (ndi, srt, rtmp, usb)")
    .option("--name <name>", "Camera display name")
    .option("--url <url>", "Camera source URL")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.prism.create({
          sourceType: opts.sourceType,
          name: opts.name,
          url: opts.url,
        });
        console.log(chalk.green(`Camera registered: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  prism
    .command("ptz")
    .description("Control camera PTZ (Pan-Tilt-Zoom)")
    .requiredOption("--camera-id <cameraId>", "Camera ID")
    .option("--pan <degrees>", "Pan angle in degrees")
    .option("--tilt <degrees>", "Tilt angle in degrees")
    .option("--zoom <level>", "Zoom level (0-100)")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const params: Record<string, unknown> = {
          cameraId: opts.cameraId,
        };
        if (opts.pan !== undefined) params.pan = parseFloat(opts.pan);
        if (opts.tilt !== undefined) params.tilt = parseFloat(opts.tilt);
        if (opts.zoom !== undefined) params.zoom = parseFloat(opts.zoom);
        const result = await client.prism.ptz(params);
        console.log(chalk.green("PTZ command sent."));
        formatOutput(result, program.opts());
      }),
    );
}
