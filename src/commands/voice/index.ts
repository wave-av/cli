import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";

export function registerVoiceCommands(program: Command): void {
  const voice = program.command("voice").description("Voice synthesis and cloning");

  voice
    .command("synthesize")
    .description("Synthesize text to speech")
    .requiredOption("--text <text>", "Text to synthesize")
    .requiredOption("--voice-id <voiceId>", "Voice ID to use")
    .option("--output <path>", "Output audio file path")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.voice.synthesize({
          text: opts.text,
          voiceId: opts.voiceId,
          output: opts.output,
        });
        console.log(chalk.green("Speech synthesized successfully."));
        formatOutput(result, program.opts());
      }),
    );

  voice
    .command("clone")
    .description("Clone a voice from a sample")
    .requiredOption("--name <name>", "Name for the cloned voice")
    .option("--sample <path>", "Path to voice sample audio file")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.voice.clone({
          name: opts.name,
          samplePath: opts.sample,
        });
        console.log(chalk.green(`Voice cloned: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  voice
    .command("list-voices")
    .description("List available voices")
    .action(
      wrapCommand(async () => {
        const client = await getClient(program.opts());
        const result = await client.voice.list();
        formatOutput(result.data, program.opts());
      }),
    );
}
