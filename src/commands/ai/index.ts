import { Command } from "commander";
import type { AssistantMode } from "@wave-av/sdk";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerAICommands(program: Command): void {
  const ai = program.command("ai").description("AI-powered studio assistant");

  const assistant = ai.command("assistant").description("Studio AI assistant");

  assistant
    .command("start")
    .description("Start an AI assistant for a stream")
    .requiredOption("--stream-id <streamId>", "Stream ID")
    .requiredOption(
      "--mode <mode>",
      "Assistant mode: auto_director | graphics_operator | audio_mixer | replay_operator | content_moderator | engagement_manager",
    )
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.startAssistant({
          stream_id: opts.streamId,
          mode: opts.mode as AssistantMode,
        });
        console.log(chalk.green(`AI assistant started: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  assistant
    .command("stop <assistantId>")
    .description("Stop an AI assistant")
    .action(
      wrapCommand(async (assistantId: string) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.stopAssistant(assistantId);
        console.log(chalk.green("AI assistant stopped."));
        formatOutput(result, program.opts());
      }),
    );

  ai.command("suggestions")
    .description("List AI suggestions for a stream or assistant")
    .option("--stream-id <streamId>", "Filter by stream ID")
    .option("--assistant-id <assistantId>", "Filter by assistant ID")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.studioAI.listSuggestions({
          stream_id: opts.streamId,
          assistant_id: opts.assistantId,
        });
        formatOutput(result.data, program.opts());
      }),
    );
}
