import { describe, expect, it } from "vitest";
import { maskSecret } from "./mask.js";

/**
 * Security regression test for CodeQL js/clear-text-logging (alert #1).
 * `wave doctor` printed `apiKey.slice(0, 12)` — a 12-character PREFIX of a live API key.
 */
describe("maskSecret", () => {
  it("never reveals the start of a secret", () => {
    const key = "wv_live_abcdefghijklmnop";
    const masked = maskSecret(key);

    expect(masked).not.toContain("wv_live");
    expect(masked).not.toContain(key.slice(0, 12));
    expect(masked.startsWith("****")).toBe(true);
  });

  it("reveals at most the last 4 characters", () => {
    expect(maskSecret("wv_live_abcdefghijklmnop")).toBe("****mnop");
  });

  it("masks short values completely rather than revealing most of them", () => {
    expect(maskSecret("short")).toBe("****");
    expect(maskSecret("elevenchar")).toBe("****");
  });

  it("does not leak the length of the secret", () => {
    expect(maskSecret("a".repeat(20))).toHaveLength(maskSecret("b".repeat(200)).length);
  });

  it("handles empty and nullish input without throwing", () => {
    expect(maskSecret("")).toBe("****");
    expect(maskSecret(null)).toBe("****");
    expect(maskSecret(undefined)).toBe("****");
  });
});
