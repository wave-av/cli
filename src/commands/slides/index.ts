import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerSlidesCommands(program: Command): void {
  const slides = program.command("slides").description("Slide presentation tools");

  slides
    .command("convert")
    .description("Convert a presentation file for streaming")
    .requiredOption("--title <title>", "Title for the converted deck")
    .requiredOption("--input-url <url>", "URL of the presentation file")
    .requiredOption(
      "--input-format <format>",
      "Input format (pptx, pdf, google_slides, keynote)",
    )
    .option("--resolution <resolution>", 'Output resolution (e.g. "1920x1080")')
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Conversion reads the deck from a URL; it does not upload a local file.
        const result = await client.slides.convert({
          title: opts.title,
          input_url: opts.inputUrl,
          input_format: oneOf("--input-format", opts.inputFormat, [
            "pptx",
            "pdf",
            "google_slides",
            "keynote",
          ]),
          resolution: opts.resolution,
        });
        console.log(chalk.green("Presentation converted."));
        formatOutput(result, program.opts());
      }),
    );

  slides
    .command("present")
    .description("Start a slide presentation in a production")
    .requiredOption("--production-id <productionId>", "Production ID")
    .option("--slide-deck <id>", "Slide deck ID")
    .action(
      wrapCommand(async () => {
        // SlidesAPI is a document-conversion service (convert/get/list/remove/
        // getProgress/addNarration/waitForReady) — there is no live-production
        // "present" control route.
        throw new Error("Starting a live slide presentation is not supported by the current SDK.");
      }),
    );

  slides
    .command("annotate")
    .description("Enable slide annotations")
    .requiredOption("--production-id <productionId>", "Production ID")
    .option("--tool <tool>", "Annotation tool (pen, highlight, pointer)", "pen")
    .action(
      wrapCommand(async () => {
        throw new Error("Slide annotation tools are not supported by the current SDK.");
      }),
    );
}
