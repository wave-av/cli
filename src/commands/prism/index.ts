import { Command } from "commander";
import chalk from "chalk";
import { getClient } from "../../lib/api-client.js";
import { formatOutput } from "../../lib/output/index.js";
import { wrapCommand } from "../../lib/errors.js";
import { oneOf } from "../../lib/options.js";

export function registerPrismCommands(program: Command): void {
  const prism = program.command("prism").description("Camera discovery and PTZ control");

  prism
    .command("discover")
    .description("Discover available cameras on the network")
    .option("--protocol <protocol>", "Comma-separated protocols to scan for")
    .option("--subnet <subnet>", "Subnet to scan (CIDR)")
    .option("--timeout <ms>", "Discovery timeout in milliseconds", "5000")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.prism.discoverSources({
          protocols: opts.protocol ? (opts.protocol as string).split(",").map((p: string) => p.trim()) : undefined,
          subnet: opts.subnet,
          timeout: parseInt(opts.timeout, 10),
        });
        formatOutput(result, program.opts());
      }),
    );

  prism
    .command("create")
    .description("Register a virtual camera or microphone device")
    .requiredOption("--type <type>", "Device type (camera, microphone)")
    .requiredOption("--source-protocol <protocol>", "Source protocol (ndi, onvif, srt, rtmp, webrtc, dante, cloudflare, livekit)")
    .requiredOption("--source-endpoint <endpoint>", "Source endpoint address/URL")
    .requiredOption("--node-id <nodeId>", "Node the device is attached to")
    .option("--name <name>", "Camera display name")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        const result = await client.prism.createDevice({
          name: opts.name ?? opts.sourceEndpoint,
          type: oneOf("--type", opts.type, ["camera", "microphone"] as const),
          source_protocol: oneOf("--source-protocol", opts.sourceProtocol, [
            "ndi",
            "onvif",
            "srt",
            "rtmp",
            "webrtc",
            "dante",
            "cloudflare",
            "livekit",
          ] as const),
          source_endpoint: opts.sourceEndpoint,
          node_id: opts.nodeId,
        });
        console.log(chalk.green(`Device registered: ${result.id}`));
        formatOutput(result, program.opts());
      }),
    );

  prism
    .command("ptz")
    .description("Recall a PTZ preset on a camera")
    .requiredOption("--device-id <deviceId>", "Device ID")
    .requiredOption("--slot <slotNumber>", "Preset slot number to recall")
    .action(
      wrapCommand(async (opts) => {
        const client = await getClient(program.opts());
        // The SDK has no free-form pan/tilt/zoom endpoint — PTZ moves are
        // triggered by recalling a pre-configured preset slot.
        await client.prism.recallPreset(opts.deviceId, parseInt(opts.slot, 10));
        console.log(chalk.green(`PTZ preset ${opts.slot} recalled on ${opts.deviceId}.`));
      }),
    );
}
