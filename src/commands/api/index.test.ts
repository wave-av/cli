import { describe, expect, it } from "vitest";
import { buildApiUrl } from "./index.js";

describe("wave api: buildApiUrl", () => {
  const base = "https://api.wave.online";

  it("resolves relative paths against the API host (1.0.10 defaulted to wave.online)", () => {
    expect(String(buildApiUrl(base, "/v1/billing"))).toBe("https://api.wave.online/v1/billing");
    expect(String(buildApiUrl(`${base}/`, "v1/usage"))).toBe("https://api.wave.online/v1/usage");
  });

  it("accepts an absolute URL on the same origin", () => {
    expect(String(buildApiUrl(base, "https://api.wave.online/v1/usage?x=1"))).toBe(
      "https://api.wave.online/v1/usage?x=1",
    );
  });

  it("refuses to send the credential to any other origin", () => {
    expect(() => buildApiUrl(base, "https://wave.online/api/billing/status")).toThrow(/Refusing to send/);
    expect(() => buildApiUrl(base, "https://evil.example/v1/me")).toThrow(/Refusing to send/);
    expect(() => buildApiUrl(base, "http://api.wave.online/v1/me")).toThrow(/Refusing to send/);
  });
});
