import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerAICommands(program: Command): void {
  const ai = program.command("ai").description("AI-powered studio assistant");

  const assistant = ai.command("assistant").description("Studio AI assistant");

  assistant
    .command("start")
    .description("Start the AI assistant for a production")
    .requiredOption("--production-id <productionId>", "Production ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.start({
          productionId: opts.productionId,
        });
        console.log(chalk.green("AI assistant started."));
        formatOutput(result, program.opts());
      }),
    );

  assistant
    .command("stop")
    .description("Stop the AI assistant for a production")
    .requiredOption("--production-id <productionId>", "Production ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.stop({
          productionId: opts.productionId,
        });
        console.log(chalk.green("AI assistant stopped."));
        formatOutput(result, program.opts());
      }),
    );

  ai.command("suggestions")
    .description("Get AI suggestions for the current production")
    .requiredOption("--production-id <productionId>", "Production ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.suggestions({
          productionId: opts.productionId,
        });
        formatOutput(result, program.opts());
      }),
    );
}
