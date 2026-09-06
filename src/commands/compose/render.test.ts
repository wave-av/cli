import { describe, expect, it } from "vitest";
import { renderComposeMarkdown } from "./render.js";
import type { ComposeProposal } from "./types.js";

/**
 * Fixture shaped like the `POST /v1/compose` response example (webinar captions composition),
 * field names cited to the wire contract at commit `bb389ca`.
 */
const FIXTURE: ComposeProposal = {
  id: "prp_webinar_fixture",
  intent: "live captions for tomorrow's webinar",
  stages: [
    { product: "realtime", why: "carries your webinar audio in real time" },
    { product: "transcribe", why: "turns speech into timed text as it happens" },
    { product: "captions", why: "puts that text on the stream for viewers" },
  ],
  productIds: ["realtime", "transcribe", "captions"],
  tools: ["perception_subscribe", "wave_create_transcription", "wave_create_caption_job"],
  scopes: [
    { scope: "realtime:read", mintable: true, source: "open-by-default.ts:101" },
    { scope: "captions:write", mintable: false, source: "open-by-default.ts:140" },
  ],
  priceRows: [
    {
      product: "captions",
      meter: "wave_caption_minutes",
      usd: 0.025,
      unit: "caption minute",
      quotedAt: 1757100000,
      validForS: 60,
    },
    {
      product: "realtime",
      meter: "wave_realtime_video_minutes",
      quote: "quote at call time",
      reason: "gateway default, no quote_token",
    },
  ],
  callShape: {
    http: "curl -X POST https://gateway.wave.online/v1/captions ...",
    mcp: { tool: "wave_create_caption_job", args: { streamId: "str_1" } },
  },
  next: ["Add chapters after the webinar ends", "Save the caption style as a preset"],
  executes: false,
  grounding: "live",
  groundedAt: "2026-09-06T04:12:09Z",
  manifestHash: "sha256:59b188cc",
  engine: { route: "dispatch", promptHash: "sha256:abc", model: null },
  flowId: null,
};

describe("renderComposeMarkdown", () => {
  it("is pure and deterministic: the same proposal always renders the same string", () => {
    expect(renderComposeMarkdown(FIXTURE)).toBe(renderComposeMarkdown(FIXTURE));
  });

  it("renders stages with their why lines", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("1. **realtime** - carries your webinar audio in real time");
    expect(out).toContain("2. **transcribe** - turns speech into timed text as it happens");
    expect(out).toContain("3. **captions** - puts that text on the stream for viewers");
  });

  it("renders scopes with mintable flags and source", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("`realtime:read` (mintable) - open-by-default.ts:101");
    expect(out).toContain("`captions:write` (not mintable) - open-by-default.ts:140");
  });

  it("renders a quoted price row with the usd amount", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("captions: $0.025 / caption minute");
    expect(out).toContain("quoted at 1757100000");
  });

  it("renders an unquoted price row as the literal quote-at-call-time reason, never a number", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("realtime: quote at call time (wave_realtime_video_minutes) - gateway default, no quote_token");
  });

  it("renders the http callShape", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("curl -X POST https://gateway.wave.online/v1/captions ...");
  });

  it("never claims executes: true", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("Executes: false");
  });

  it("renders 'none saved yet' when flowId is null", () => {
    const out = renderComposeMarkdown(FIXTURE);
    expect(out).toContain("Flow: none saved yet");
  });

  it("renders the saved flow id when present", () => {
    const out = renderComposeMarkdown({ ...FIXTURE, flowId: "flw_abc123" });
    expect(out).toContain("Flow: flw_abc123");
  });
});
