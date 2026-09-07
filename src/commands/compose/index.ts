import { Command } from "commander";
import { getClient } from "../../lib/api-client.js";
import { wrapCommand } from "../../lib/errors.js";
import { renderComposeMarkdown } from "./render.js";
import type { ComposeProposal, ComposeRequest } from "./types.js";

interface ComposeOptions {
  json?: boolean;
  flow?: string;
  budget?: string;
  save?: boolean;
}

/**
 * `wave compose "<intent>"` calls `POST /v1/compose` - a proposal, never a call. The proposal's
 * own `executes` field is always `false` (the gateway's canon, never derived here). No subcommand
 * of `wave compose` calls a product route; `--save` prints a request for a human to run in a
 * signed-in console session, it does not call the console route itself (see `printSaveRequest`).
 */
export function registerComposeCommands(program: Command): void {
  program
    .command("compose <intent>")
    .description(
      "Propose a composition of WAVE products for an intent (POST /v1/compose). A proposal only; never executes.",
    )
    .option("--json", "Print the raw compose response as JSON instead of markdown")
    .option("--flow <id>", "Re-propose a previously saved flow (sends flowId)")
    .option("--budget <usd>", "Budget ceiling in USD for the composition (sends budgetUsd)")
    .option("--save", "Print the request needed to save this proposal as a flow in the console")
    .action(
      wrapCommand(async (intent: string, opts: ComposeOptions) => {
        const body: ComposeRequest = { intent };

        if (opts.budget !== undefined) {
          const budgetUsd = Number(opts.budget);
          if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
            throw new Error(`--budget must be a non-negative number, got "${opts.budget}"`);
          }
          body.budgetUsd = budgetUsd;
        }

        if (opts.flow !== undefined) {
          body.flowId = opts.flow;
        }

        const client = await getClient(program.opts());
        const proposal = await client.client.post<ComposeProposal>("/v1/compose", body);

        if (opts.json) {
          console.log(JSON.stringify(proposal, null, 2));
        } else {
          console.log(renderComposeMarkdown(proposal));
        }

        if (opts.save) {
          printSaveRequest(proposal);
        }
      }),
    );
}

/**
 * The console flows route (`POST /api/console/flows`) is session-cookie only today; there is no
 * machine-auth token yet for CLI/SDK/MCP callers to save a flow on their own. Until that lands,
 * `--save` never silently no-ops and it never calls a product route or the console route itself:
 * it prints the exact request a signed-in human can paste into their own console session.
 */
function printSaveRequest(proposal: ComposeProposal): void {
  const body = {
    proposal,
    createdBy: { kind: "wave-composer" },
    manifestHash: proposal.manifestHash,
    groundedAt: proposal.groundedAt,
  };

  console.log("");
  console.log(
    "Saving a flow from the CLI needs a signed-in console session; no CLI machine-auth token exists yet.",
  );
  console.log("Paste this into a signed-in console session (replace $WAVE_CONSOLE_URL with your console origin):");
  console.log("");
  console.log(
    [
      'curl -X POST "$WAVE_CONSOLE_URL/api/console/flows" \\',
      '  -H "Content-Type: application/json" \\',
      "  --cookie \"<your console session cookie>\" \\",
      `  -d '${JSON.stringify(body)}'`,
    ].join("\n"),
  );
}
