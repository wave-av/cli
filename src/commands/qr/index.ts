import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerQrCommands(program: Command): void {
  const qr = program.command("qr").description("QR code generation and scanning");

  qr.command("create")
    .description("Generate a QR code")
    .requiredOption("--data <data>", "Data to encode in the QR code")
    .option("--format <format>", "Output format (png, svg)", "png")
    .option("--size <size>", "QR code size in pixels", "256")
    .option("--output <path>", "Output file path")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.qr.create({
          data: opts.data,
          format: opts.format,
          size: parseInt(opts.size),
          output: opts.output,
        });
        console.log(chalk.green("QR code generated."));
        formatOutput(result, program.opts());
      }),
    );

  qr.command("scan")
    .description("Scan a QR code from an image")
    .requiredOption("--image-path <path>", "Path to image file containing QR code")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.qr.scan({ imagePath: opts.imagePath });
        formatOutput(result, program.opts());
      }),
    );

  qr.command("list")
    .description("List generated QR codes")
    .option("--limit <n>", "Maximum results", "20")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.qr.list({ limit: parseInt(opts.limit) });
        formatOutput(result.data, program.opts());
      }),
    );
}
