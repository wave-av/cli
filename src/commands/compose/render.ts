import type { ComposeProposal, ComposePriceRow } from "./types.js";
import { isQuotedPriceRow } from "./types.js";

/**
 * Pure, deterministic markdown rendering of a `ComposeProposal`. No I/O, no network - the same
 * proposal object always renders the same string, which is what the rendering-parity test in
 * `index.test.ts` checks against a recorded fixture.
 *
 * Note: the gateway's `POST /v1/compose` response (`compose-types.ts` at `wave-gateway` commit
 * `bb389ca`, branch `feat/compose-engine`) carries no `markdown` field of its own - the four
 * renderings (API, CLI, SDK, MCP) each render the structured object independently. This function
 * is the CLI's rendering; "rendering parity" here means this function is pure and deterministic
 * against a fixed fixture, not a byte-for-byte match against a gateway-side markdown string that
 * does not exist in the contract.
 */
export function renderComposeMarkdown(proposal: ComposeProposal): string {
  const lines: string[] = [];

  lines.push(`# ${proposal.intent}`, "");

  lines.push("## Stages", "");
  proposal.stages.forEach((stage, i) => {
    lines.push(`${i + 1}. **${stage.product}** - ${stage.why}`);
  });
  lines.push("");

  lines.push("## Scopes", "");
  for (const scope of proposal.scopes) {
    const mint = scope.mintable ? "mintable" : "not mintable";
    lines.push(`- \`${scope.scope}\` (${mint}) - ${scope.source}`);
  }
  lines.push("");

  lines.push("## Price rows", "");
  for (const row of proposal.priceRows) {
    lines.push(`- ${renderPriceRow(row)}`);
  }
  lines.push("");

  lines.push("## Call shape", "");
  lines.push("```", proposal.callShape.http, "```");
  if (proposal.callShape.mcp) {
    lines.push("", `MCP tool: \`${proposal.callShape.mcp.tool}\``);
  }
  lines.push("");

  lines.push("## Next", "");
  for (const step of proposal.next) {
    lines.push(`- ${step}`);
  }
  lines.push("");

  lines.push(
    `Grounding: ${proposal.grounding} (as of ${proposal.groundedAt})`,
    `Manifest: ${proposal.manifestHash}`,
    `Engine route: ${proposal.engine.route}`,
    `Flow: ${proposal.flowId ?? "none saved yet"}`,
    `Executes: ${proposal.executes} - this is a plan, not a call`,
  );

  return lines.join("\n");
}

function renderPriceRow(row: ComposePriceRow): string {
  if (isQuotedPriceRow(row)) {
    return `${row.product}: $${row.usd} / ${row.unit} (meter ${row.meter}, quoted at ${row.quotedAt}, valid ${row.validForS}s)`;
  }
  const meter = row.meter ?? "no meter";
  return `${row.product}: ${row.quote} (${meter}) - ${row.reason}`;
}
