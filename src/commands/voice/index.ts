import { Command } from "commander";
import { writeFile } from "node:fs/promises";
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
          voice_id: opts.voiceId,
        });
        // The API returns an audio URL rather than bytes, so --output is a
        // client-side fetch of that URL.
        if (opts.output) {
          if (!result.audio_url) {
            throw new Error(
              `Synthesis ${result.id} has no audio URL yet (status: ${result.status}).`,
            );
          }
          const response = await fetch(result.audio_url);
          if (!response.ok) {
            throw new Error(
              `Audio download failed: ${response.status} ${response.statusText}`,
            );
          }
          await writeFile(opts.output, Buffer.from(await response.arrayBuffer()));
          console.log(chalk.green(`Speech synthesized to ${opts.output}.`));
        } else {
          console.log(chalk.green("Speech synthesized successfully."));
        }
        formatOutput(result, program.opts());
      }),
    );

  voice
    .command("clone")
    .description("Clone a voice from a sample")
    .requiredOption("--name <name>", "Name for the cloned voice")
    .requiredOption(
      "--sample-urls <urls>",
      "Comma-separated URLs of voice sample audio (min ~1 minute of clean audio)",
    )
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // Cloning trains from sample URLs; it does not upload a local file.
        const result = await client.voice.cloneVoice({
          name: opts.name,
          sample_urls: (opts.sampleUrls as string)
            .split(",")
            .map((u: string) => u.trim())
            .filter(Boolean),
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
        const result = await client.voice.listVoices();
        formatOutput(result.data, program.opts());
      }),
    );
}
