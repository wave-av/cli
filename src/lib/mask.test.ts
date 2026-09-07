import { describe, expect, it } from "vitest";
import { ABSENT_PLACEHOLDER, MASKED_PLACEHOLDER, maskSecret } from "./mask.js";

/**
 * Security regression test for CodeQL js/clear-text-logging (alert #1).
 * `wave doctor` printed `apiKey.slice(0, 12)` — a 12-character PREFIX of a live API key.
 */
describe("maskSecret", () => {
  const fixtureValue = "wv_fake_abcdefghijklmnop";

  it("reveals no part of the secret at all", () => {
    const masked = maskSecret(fixtureValue);

    expect(masked).toBe(MASKED_PLACEHOLDER);
    // No substring of the input of length >= 2 may survive into the output.
    for (let start = 0; start < fixtureValue.length - 1; start += 1) {
      for (let end = start + 2; end <= fixtureValue.length; end += 1) {
        expect(masked).not.toContain(fixtureValue.slice(start, end));
      }
    }
  });

  it("does not reveal a prefix (the original bug) or a suffix", () => {
    const masked = maskSecret(fixtureValue);
    expect(masked).not.toContain(fixtureValue.slice(0, 12));
    expect(masked).not.toContain(fixtureValue.slice(-4));
    expect(masked).not.toContain("wv_fake");
  });

  it("does not leak the length of the secret", () => {
    expect(maskSecret("a".repeat(20))).toBe(maskSecret("b".repeat(200)));
  });

  it("still distinguishes a configured secret from a missing one", () => {
    expect(maskSecret(fixtureValue)).toBe(MASKED_PLACEHOLDER);
    expect(maskSecret("")).toBe(ABSENT_PLACEHOLDER);
    expect(maskSecret(null)).toBe(ABSENT_PLACEHOLDER);
    expect(maskSecret(undefined)).toBe(ABSENT_PLACEHOLDER);
  });
});
