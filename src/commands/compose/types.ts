/**
 * Wire types for `POST /v1/compose` (served at api.wave.online).
 *
 * Mirrored structurally from the engine's wire contract at commit `bb389ca` (an unmerged branch;
 * `POST /v1/compose` is still a 501 stub on the live default route today). `@wave-av/sdk` does not
 * export these types yet (that lands in a separate SDK lane), so this command defines its own
 * local copy rather than depend on an unpublished SDK surface. Field names are canon; do not
 * rename to match unrelated conventions in this repo.
 */

export interface ComposeRequest {
  intent: string;
  budgetUsd?: number;
  flowId?: string;
}

export interface ComposeStage {
  product: string;
  why: string;
}

export interface ComposeScopeRow {
  scope: string;
  mintable: boolean;
  source: string;
}

export interface QuotedPriceRow {
  product: string;
  meter: string;
  usd: number;
  unit: string;
  quotedAt: number;
  validForS: number;
}

export interface UnquotedPriceRow {
  product: string;
  meter: string | null;
  quote: "quote at call time";
  reason: string;
}

export type ComposePriceRow = QuotedPriceRow | UnquotedPriceRow;

export function isQuotedPriceRow(row: ComposePriceRow): row is QuotedPriceRow {
  return typeof (row as QuotedPriceRow).usd === "number";
}

export interface ComposeCallShape {
  http: string;
  mcp: { tool: string; args: Record<string, unknown> } | null;
}

export type ComposeEngineRoute = "dispatch" | "deterministic-fallback";

export interface ComposeEngineInfo {
  route: ComposeEngineRoute;
  promptHash: string;
  model: null;
}

/** `POST /v1/compose` response, the stored proposal. */
export interface ComposeProposal {
  id: string;
  intent: string;
  stages: ComposeStage[];
  productIds: string[];
  tools: string[];
  scopes: ComposeScopeRow[];
  priceRows: ComposePriceRow[];
  callShape: ComposeCallShape;
  next: string[];
  executes: false;
  grounding: "live" | "snapshot";
  groundedAt: string;
  manifestHash: string;
  engine: ComposeEngineInfo;
  flowId: string | null;
}
