import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerSlidesCommands(program: Command): void {
  const slides = program.command("slides").description("Slide presentation tools");

  slides
    .command("convert")
    .description("Convert a presentation file for streaming")
    .requiredOption("--input-file <path>", "Path to presentation file (pptx, pdf, keynote)")
    .option("--output <path>", "Output directory")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.slides.convert({
          inputFile: opts.inputFile,
          output: opts.output,
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
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.slides.present({
          productionId: opts.productionId,
          slideDeckId: opts.slideDeck,
        });
        console.log(chalk.green("Presentation started."));
        formatOutput(result, program.opts());
      }),
    );

  slides
    .command("annotate")
    .description("Enable slide annotations")
    .requiredOption("--production-id <productionId>", "Production ID")
    .option("--tool <tool>", "Annotation tool (pen, highlight, pointer)", "pen")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.slides.annotate({
          productionId: opts.productionId,
          tool: opts.tool,
        });
        console.log(chalk.green("Annotations enabled."));
        formatOutput(result, program.opts());
      }),
    );
}
