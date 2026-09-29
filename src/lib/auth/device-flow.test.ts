import { describe, expect, it, vi } from "vitest";
import { startDeviceAuth, pollForToken } from "./device-flow.js";

/**
 * 1.0.10 posted to /api/oauth/device/authorize|token, which the gateway answers 404
 * ROUTE_NOT_FOUND, so `wave auth login` failed before printing a code. The served ceremony is
 * POST /v1/agent/auth/device and POST /v1/agent/auth/token (openapi agentAuthDevice/agentAuthToken).
 */

const BASE = "https://api.wave.online";
const quiet = { log: () => undefined, openBrowser: false, sleep: async () => undefined };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("startDeviceAuth", () => {
  it("POSTs to /v1/agent/auth/device on the API host and returns the grant", async () => {
    const grant = {
      device_code: "dev_123",
      user_code: "ABCD-EFGH",
      verification_uri: "https://api.wave.online/agent/auth/verify",
      expires_in: 600,
      interval: 5,
    };
    const fetchImpl = vi.fn(async () => json(200, grant));
    const lines: string[] = [];

    const result = await startDeviceAuth(BASE, { ...quiet, fetchImpl, log: (l) => lines.push(l) });

    expect(result).toEqual(grant);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/agent/auth/device`);
    expect(url).not.toContain("/api/oauth");
    expect(init.method).toBe("POST");
    expect(lines.join("\n")).toContain("ABCD-EFGH");
  });

  it("surfaces the gateway's status and code when the ceremony cannot start", async () => {
    const fetchImpl = vi.fn(async () =>
      json(404, { error: { code: "ROUTE_NOT_FOUND", message: "No WAVE capability is served at this path." } }),
    );
    await expect(startDeviceAuth(BASE, { ...quiet, fetchImpl })).rejects.toThrow(/404 ROUTE_NOT_FOUND/);
  });
});

describe("pollForToken", () => {
  it("keeps polling through authorization_pending and slow_down, then returns the tokens", async () => {
    const responses = [
      json(400, { error: "authorization_pending" }),
      json(400, { error: "slow_down" }),
      json(200, { access_token: "at_1", refresh_token: "rt_1", token_type: "Bearer", expires_in: 3600 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const sleeps: number[] = [];

    const tokens = await pollForToken(BASE, "dev_123", 1, 60, {
      ...quiet,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(tokens.access_token).toBe("at_1");
    expect(tokens.refresh_token).toBe("rt_1");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/v1/agent/auth/token`);
    expect(JSON.parse(String(init.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: "dev_123",
    });
    // slow_down adds 5s to every later wait (RFC 8628 §3.5)
    expect(sleeps).toEqual([1000, 1000, 6000]);
  });

  it("stops on access_denied and expired_token", async () => {
    await expect(
      pollForToken(BASE, "d", 1, 60, { ...quiet, fetchImpl: vi.fn(async () => json(400, { error: "access_denied" })) }),
    ).rejects.toThrow(/denied/);
    await expect(
      pollForToken(BASE, "d", 1, 60, { ...quiet, fetchImpl: vi.fn(async () => json(400, { error: "expired_token" })) }),
    ).rejects.toThrow(/expired.*wave auth login/);
  });
});
