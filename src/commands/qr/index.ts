import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerQrCommands(program: Command): void {
  const qr = program.command("qr").description("QR code generation and scanning");

  qr.command("create")
    .description("Generate a QR code")
    .requiredOption("--content <content>", "Content to encode in the QR code")
    .option("--type <type>", "QR type (url, stream, vcard, wifi, text, dynamic)", "url")
    .option("--format <format>", "Rendered image format (png, svg, pdf)", "png")
    .option("--size <size>", "QR code size in pixels", "256")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const qr = await client.qr.create({
          type: oneOf("--type", opts.type, [
            "url",
            "stream",
            "vcard",
            "wifi",
            "text",
            "dynamic",
          ]),
          content: opts.content,
        });
        // Rendering is a separate call; the API returns a URL for the image
        // rather than writing bytes.
        const image = await client.qr.getImage(
          qr.id,
          oneOf("--format", opts.format, ["png", "svg", "pdf"]),
          parseInt(opts.size),
        );
        console.log(chalk.green(`QR code generated: ${image.url}`));
        formatOutput({ ...qr, image_url: image.url }, program.opts());
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
