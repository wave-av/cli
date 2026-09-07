import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerAudienceCommands(program: Command): void {
  const audience = program.command("audience").description("Audience engagement tools");

  // Polls
  const polls = audience.command("polls").description("Manage audience polls");

  polls
    .command("create")
    .description("Create an audience poll")
    .requiredOption("--question <question>", "Poll question")
    .requiredOption("--options <options>", "Comma-separated poll options")
    .requiredOption("--stream-id <streamId>", "Stream to attach the poll to")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const options = (opts.options as string).split(",").map((o: string) => o.trim());
        const result = await client.audience.createPoll({
          question: opts.question,
          options,
          stream_id: opts.streamId,
        });
        console.log(chalk.green(`Poll created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  polls
    .command("list")
    .description("List polls")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .action(
      wrapCommand(async () => {
        // The SDK's AudienceAPI has no poll-listing route (only createPoll,
        // getPoll, closePoll, getPollResults, vote) — there is no server-side
        // "list" to call. Fail loudly rather than fake a result.
        throw new Error(
          "Listing polls is not supported by the current SDK. Use `wave audience polls results <id>` for a specific poll.",
        );
      }),
    );

  polls
    .command("results <id>")
    .description("Get poll results")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.audience.getPollResults(id);
        formatOutput(result, program.opts());
      }),
    );

  polls
    .command("close <id>")
    .description("Close an active poll")
    .action(
      wrapCommand(async (id: string) => {
        const client = await getClient(program.opts());
        const result = await client.audience.closePoll(id);
        console.log(chalk.green(`Poll ${id} closed.`));
        formatOutput(result, program.opts());
      }),
    );

  // Questions
  const questions = audience.command("questions").description("Manage audience Q&A");

  questions
    .command("create")
    .description("Open a Q&A session")
    .requiredOption("--stream-id <streamId>", "Stream to attach the Q&A session to")
    .option("--moderated", "Enable moderation", false)
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.audience.createQA({
          stream_id: opts.streamId,
          moderated: opts.moderated,
        });
        console.log(chalk.green(`Q&A session created: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  questions
    .command("list")
    .description("List questions in a Q&A session")
    .requiredOption("--session-id <sessionId>", "Q&A session ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The SDK exposes questions as part of the Q&A session, not a separate list route.
        const session = await client.audience.getQA(opts.sessionId);
        formatOutput(session.questions, program.opts());
      }),
    );

  // Reactions
  const reactions = audience.command("reactions").description("Manage audience reactions");

  reactions
    .command("enable")
    .description("Enable reactions for a stream")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .action(
      wrapCommand(async () => {
        // The SDK's AudienceAPI has no enable/disable toggle for reactions —
        // only sendReaction (fire one burst) and getReactionMetrics exist.
        // There is nothing to call here; fail loudly rather than pretend.
        throw new Error(
          "Enabling/disabling reactions is not supported by the current SDK. Reactions are fired per-event via sendReaction.",
        );
      }),
    );

  reactions
    .command("disable")
    .description("Disable reactions for a stream")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .action(
      wrapCommand(async () => {
        throw new Error(
          "Enabling/disabling reactions is not supported by the current SDK. Reactions are fired per-event via sendReaction.",
        );
      }),
    );
}
