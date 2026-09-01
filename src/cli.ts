import { Command } from "commander";
import chalk from "chalk";
import { registerAuthCommands } from "./commands/auth/index.js";
import { registerOrgCommands } from "./commands/org/index.js";
import { registerConfigCommands } from "./commands/config/index.js";
import { registerStreamCommands } from "./commands/stream/index.js";
import { registerStudioCommands } from "./commands/studio/index.js";
import { registerClipCommands } from "./commands/clips/index.js";
import { registerEditorCommands } from "./commands/editor/index.js";
import { registerVoiceCommands } from "./commands/voice/index.js";
import { registerPhoneCommands } from "./commands/phone/index.js";
import { registerCollabCommands } from "./commands/collab/index.js";
import { registerCaptionsCommands } from "./commands/captions/index.js";
import { registerChaptersCommands } from "./commands/chapters/index.js";
import { registerAICommands } from "./commands/ai/index.js";
import { registerTranscribeCommands } from "./commands/transcribe/index.js";
import { registerSentimentCommands } from "./commands/sentiment/index.js";
import { registerSearchCommands } from "./commands/search/index.js";
import { registerSceneCommands } from "./commands/scene/index.js";
import { registerFleetCommands } from "./commands/fleet/index.js";
import { registerGhostCommands } from "./commands/ghost/index.js";
import { registerMeshCommands } from "./commands/mesh/index.js";
import { registerEdgeCommands } from "./commands/edge/index.js";
import { registerAnalyticsCommands } from "./commands/analytics/index.js";
import { registerPrismCommands } from "./commands/prism/index.js";
import { registerZoomCommands } from "./commands/zoom/index.js";
import { registerVaultCommands } from "./commands/vault/index.js";
import { registerMarketplaceCommands } from "./commands/marketplace/index.js";
import { registerConnectCommands } from "./commands/connect/index.js";
import { registerWebhookSubscriptionCommands, registerIdentityCommands } from "./commands/webhook-subscriptions/index.js";
import { registerDistributionCommands } from "./commands/distribution/index.js";
import { registerDesktopCommands } from "./commands/desktop/index.js";
import { registerSignageCommands } from "./commands/signage/index.js";
import { registerQrCommands } from "./commands/qr/index.js";
import { registerAudienceCommands } from "./commands/audience/index.js";
import { registerCreatorCommands } from "./commands/creator/index.js";
import { registerPodcastCommands } from "./commands/podcast/index.js";
import { registerSlidesCommands } from "./commands/slides/index.js";
import { registerUsbCommands } from "./commands/usb/index.js";
import { registerNotifyCommands } from "./commands/notify/index.js";
import { registerDrmCommands } from "./commands/drm/index.js";
import { registerBillingCommands } from "./commands/billing/index.js";
import { registerListenCommands } from "./commands/listen/index.js";
import { registerLogsCommands } from "./commands/logs/index.js";
import { registerTriggerCommands } from "./commands/trigger/index.js";
import { registerDevCommands } from "./commands/dev/index.js";
import { registerOpenCommands } from "./commands/open/index.js";
import { registerInitCommands } from "./commands/init/index.js";
import { registerAdminCommands } from "./commands/admin/index.js";
import { registerDoctorCommands } from "./commands/doctor/index.js";
import { registerStatusCommands } from "./commands/status/index.js";
import { registerCompletionCommands } from "./commands/completion/index.js";
import { registerApiCommands } from "./commands/api/index.js";
import { registerLinkCommands } from "./commands/link/index.js";
import { detectEnvironment } from "./lib/environment.js";

function printBanner(): void {
  // WAVE brand gradient: blue (#3366FF) -> purple (#7B41E8) -> cyan (#33BBCC)
  const b = chalk.hex("#3366FF"); // primary blue
  const p = chalk.hex("#7B41E8"); // secondary purple
  const c = chalk.hex("#33BBCC"); // accent cyan
  const d = chalk.dim;

  console.log("");
  console.log(`  ${b("██╗    ██╗")} ${p("█████╗ ")} ${p("██╗   ██╗")} ${c("███████╗")}`);
  console.log(`  ${b("██║    ██║")} ${p("██╔══██╗")} ${p("██║   ██║")} ${c("██╔════╝")}`);
  console.log(`  ${b("██║ █╗ ██║")} ${p("███████║")} ${p("██║   ██║")} ${c("█████╗  ")}`);
  console.log(`  ${b("██║███╗██║")} ${p("██╔══██║")} ${p("╚██╗ ██╔╝")} ${c("██╔══╝  ")}`);
  console.log(`  ${b("╚███╔███╔╝")} ${p("██║  ██║")} ${p(" ╚████╔╝ ")} ${c("███████╗")}`);
  console.log(`  ${b(" ╚══╝╚══╝ ")} ${p("╚═╝  ╚═╝")} ${p("  ╚═══╝  ")} ${c("╚══════╝")}`);
  console.log("");
  console.log(`  ${d("Enterprise Streaming Platform")}  ${chalk.hex("#555")("v1.0.0")}`);
  console.log(`  ${d("─".repeat(45))}`);
  console.log("");
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("wave")
    .description("WAVE CLI - Command-line interface for the WAVE streaming platform")
    .version("1.0.0", "-v, --version")
    .option("-o, --output <format>", "Output format: table, json, yaml", "table")
    .option("--project <name>", "Override project context")
    .option("--org <id>", "Override organization")
    .option("-c, --confirm", "Skip confirmation prompts")
    .option("--no-color", "Disable colored output")
    .option("--debug", "Verbose debug logging");

  // Auth & Config
  registerAuthCommands(program);
  registerOrgCommands(program);
  registerConfigCommands(program);
  registerInitCommands(program);
  registerLinkCommands(program);

  // Core APIs (P1)
  registerStreamCommands(program);
  registerStudioCommands(program);

  // Production (P1)
  registerClipCommands(program);
  registerEditorCommands(program);
  registerVoiceCommands(program);
  registerPhoneCommands(program);
  registerCollabCommands(program);
  registerCaptionsCommands(program);
  registerChaptersCommands(program);
  registerAICommands(program);
  registerTranscribeCommands(program);

  // Intelligence (P2)
  registerSentimentCommands(program);
  registerSearchCommands(program);
  registerSceneCommands(program);

  // Enterprise (P2)
  registerFleetCommands(program);
  registerGhostCommands(program);
  registerMeshCommands(program);
  registerEdgeCommands(program);
  registerAnalyticsCommands(program);
  registerPrismCommands(program);
  registerZoomCommands(program);

  // Content & Commerce (P3)
  registerVaultCommands(program);
  registerMarketplaceCommands(program);
  registerConnectCommands(program);
  registerWebhookSubscriptionCommands(program);
  registerIdentityCommands(program);
  registerDistributionCommands(program);
  registerDesktopCommands(program);
  registerSignageCommands(program);
  registerQrCommands(program);
  registerAudienceCommands(program);
  registerCreatorCommands(program);

  // Specialized (P4)
  registerPodcastCommands(program);
  registerSlidesCommands(program);
  registerUsbCommands(program);

  // Cross-cutting
  registerNotifyCommands(program);
  registerDrmCommands(program);
  registerBillingCommands(program);

  // Developer tools
  registerListenCommands(program);
  registerLogsCommands(program);
  registerTriggerCommands(program);
  registerDevCommands(program);
  registerOpenCommands(program);

  // Admin
  registerAdminCommands(program);

  // Diagnostics & utilities
  registerDoctorCommands(program);
  registerStatusCommands(program);
  registerCompletionCommands(program);
  registerApiCommands(program);

  // Skip banner for AI agents and CI (they prefer clean output)
  const env = detectEnvironment();
  if (!env.isAgent && !env.isCI) {
    const originalHelp = program.helpInformation.bind(program);
    program.helpInformation = function () {
      printBanner();
      return originalHelp();
    };
  }

  return program;
}
