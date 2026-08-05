import { Command } from "commander";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerSentimentCommands(program: Command): void {
  const sentiment = program.command("sentiment").description("Sentiment analysis tools");

  sentiment
    .command("analyze")
    .description("Analyze sentiment of text")
    .requiredOption("--text <text>", "Text to analyze")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.sentiment.analyze({ text: opts.text });
        formatOutput(result, program.opts());
      }),
    );

  sentiment
    .command("batch")
    .description("Analyze sentiment of multiple texts from stdin")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.sentiment.batch();
        formatOutput(result, program.opts());
      }),
    );

  sentiment
    .command("trends")
    .description("View sentiment trends over time")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .option("--period <period>", "Time period (hour, day, week)", "day")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.sentiment.trends({
          streamId: opts.streamId,
          period: opts.period,
        });
        formatOutput(result, program.opts());
      }),
    );
}
