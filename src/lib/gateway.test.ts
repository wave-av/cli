import { afterEach, describe, expect, it, vi } from "vitest";
import { WaveError } from "@wave-av/sdk";
import { gatewayFetch, toGatewayError } from "./gateway.js";
import {
  AuthRequiredError,
  formatCLIError,
  KeychainTimeoutError,
  KEYCHAIN_TIMEOUT_EXIT_STATUS,
} from "./errors.js";
import { EXIT_CODES } from "./exit-codes.js";
import type { ResolvedCredentials } from "./auth/credentials.js";

const creds: ResolvedCredentials = {
  apiKey: "wave_test_key",
  source: "env",
  project: "default",
  baseUrl: "https://api.wave.online",
};

describe("toGatewayError", () => {
  it("reads the canonical nested envelope", () => {
    const err = toGatewayError(403, "Forbidden", {
      error: { code: "SCOPE_INSUFFICIENT", message: "requires scope: productions:read", request_id: "req-1" },
    });
    expect(err).toBeInstanceOf(WaveError);
    expect(err.code).toBe("SCOPE_INSUFFICIENT");
    expect(err.message).toBe("requires scope: productions:read");
    expect(err.statusCode).toBe(403);
    expect(err.requestId).toBe("req-1");
  });

  it("keeps the actionable message of the flat spend-cap 402 (1.0.10 showed 'HTTP_402 Payment Required')", () => {
    const err = toGatewayError(402, "Payment Required", {
      error: "spend_cap_exceeded",
      code: "SPEND_CAP_TIER_BLOCKED",
      message: "Add a payment method to continue — this action exceeds your plan's included allotment.",
      dimension: "wave_clip_minutes",
    });
    expect(err.code).toBe("SPEND_CAP_TIER_BLOCKED");
    expect(err.message).toMatch(/Add a payment method/);
    expect(err.details).toEqual({ dimension: "wave_clip_minutes" });
  });

  it("uses a bare string `error` as code and message (mesh: {\"error\":\"missing x-wave-node\"})", () => {
    const err = toGatewayError(400, "Bad Request", { error: "missing x-wave-node" });
    expect(err.code).toBe("missing x-wave-node");
    expect(err.message).toBe("missing x-wave-node");
  });

  it("falls back to HTTP_<status> and statusText for an empty body", () => {
    const err = toGatewayError(502, "Bad Gateway", undefined, "hdr-req");
    expect(err.code).toBe("HTTP_502");
    expect(err.message).toBe("Bad Gateway");
    expect(err.requestId).toBe("hdr-req");
  });
});

describe("gatewayFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bearer key only to the resolved API host, with CLI headers and query params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ plan: "free" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = await gatewayFetch("/v1/billing/usage", {
      credentials: creds,
      query: { from: "2026-09-01", to: undefined, limit: "" },
    });

    expect(body).toEqual({ plan: "free" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.wave.online/v1/billing/usage?from=2026-09-01");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer wave_test_key");
    expect(headers["x-wave-source"]).toBe("cli");
    expect(headers["user-agent"]).toMatch(/^wave-cli\//);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("throws a WaveError carrying the gateway code and x-request-id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "ROUTE_NOT_FOUND", message: "No WAVE capability is served at this path." } }), {
          status: 404,
          headers: { "x-request-id": "req-404" },
        }),
      ),
    );
    await expect(gatewayFetch("/v1/streams", { credentials: creds })).rejects.toMatchObject({
      code: "ROUTE_NOT_FOUND",
      statusCode: 404,
      requestId: "req-404",
    });
  });
});

describe("formatCLIError for connectivity failures", () => {
  it("reports an unserved route as not-implemented (exit 11), not an ordinary 404", () => {
    const { message, exitCode } = formatCLIError(
      new WaveError("No WAVE capability is served at this path.", "ROUTE_NOT_MAPPED", 404, "req-x"),
    );
    expect(exitCode).toBe(EXIT_CODES.NOT_IMPLEMENTED);
    expect(message).toMatch(/not served by the WAVE API/);
  });

  it("reports a missing credential as AUTH_REQUIRED (exit 2) pointing at `wave auth login`", () => {
    const { message, exitCode } = formatCLIError(new AuthRequiredError());
    expect(exitCode).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(message).toMatch(/wave auth login/);
    expect(message).not.toMatch(/`wave login`/);
  });

  it("reports a keychain timeout with its real exit status (137, SIGKILL) and the workarounds", () => {
    const { message, exitCode } = formatCLIError(
      new KeychainTimeoutError("The OS keychain did not answer within 60s (store)."),
    );
    expect(exitCode).toBe(KEYCHAIN_TIMEOUT_EXIT_STATUS);
    expect(message).toMatch(/did not answer/);
  });
});
