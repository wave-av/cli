import { Command } from "commander";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function registerSentimentCommands(program: Command): void {
  const sentiment = program.command("sentiment").description("Sentiment analysis tools");

  sentiment
    .command("analyze")
    .description("Analyze sentiment of text")
    .requiredOption("--text <text>", "Text to analyze")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.sentiment.analyzeText(opts.text);
        formatOutput(result, program.opts());
      }),
    );

  sentiment
    .command("batch")
    .description("Analyze sentiment of multiple texts, one per line, from stdin")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        // The command always advertised stdin but never actually read it.
        const stdin = await readAllStdin();
        const items = stdin
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((text) => ({ source_type: "text" as const, text }));
        if (items.length === 0) {
          throw new Error("No input on stdin. Provide one text per line.");
        }
        const result = await client.sentiment.batchAnalyze({ items });
        formatOutput(result, program.opts());
      }),
    );

  sentiment
    .command("trends")
    .description("View the sentiment trend for an analysis")
    .requiredOption("--analysis-id <analysisId>", "Sentiment analysis ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Trends are computed per analysis, not per stream over a time period.
        const result = await client.sentiment.getTrend(opts.analysisId);
        formatOutput(result, program.opts());
      }),
    );
}
