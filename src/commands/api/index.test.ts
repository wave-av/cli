import { describe, expect, it } from "vitest";
import { buildApiUrl, parseHeader } from "./index.js";

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

  it("never leaves the API origin for a non-http scheme", () => {
    // `file://` and `gopher://` have an origin of their own ("null" / the other host), so they are refused.
    expect(() => buildApiUrl(base, "file:///etc/passwd")).toThrow(/Refusing to send your WAVE credential to a file: URL/);
    expect(() => buildApiUrl(base, "gopher://api.wave.online/1")).toThrow(/Refusing to send/);
    // `data:` and `javascript:` carry no "//", so they are read as a path on the API host.
    expect(buildApiUrl(base, "data:text/plain,hi").origin).toBe(base);
    expect(buildApiUrl(base, "javascript:alert(1)").origin).toBe(base);
  });
});

describe("wave api: parseHeader (-H)", () => {
  it("splits on the first colon only and trims, like curl", () => {
    expect(parseHeader("X-Foo: bar: baz")).toEqual(["X-Foo", "bar: baz"]);
    expect(parseHeader("Idempotency-Key:abc")).toEqual(["Idempotency-Key", "abc"]);
    expect(parseHeader("X-Empty:")).toEqual(["X-Empty", ""]);
  });

  it("refuses a header with no colon instead of dropping it silently", () => {
    expect(() => parseHeader("X-Organization-Id")).toThrow(/expected "Name: value"/);
  });

  it("refuses a name that is not an HTTP token", () => {
    expect(() => parseHeader(": value")).toThrow(/not a valid header name/);
    expect(() => parseHeader("Bad Name: x")).toThrow(/not a valid header name/);
  });

  it("refuses CR, LF and NUL in a value, and never echoes the value back", () => {
    for (const raw of ["X-Test: a\r\nSet-Cookie: x", "X-Test: a\nb", "X-Test: a\u0000b"]) {
      let message = "";
      try {
        parseHeader(raw);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/X-Test.*line break or NUL/);
      expect(message).not.toMatch(/Set-Cookie|\r|\n|\u0000/);
    }
  });

  it("refuses a line break at either end of the value or the name, not only inside it", () => {
    // String.prototype.trim() strips CR and LF, so trimming before the check would let these through.
    expect(() => parseHeader("X-Test: value\r")).toThrow(/line break or NUL/);
    expect(() => parseHeader("X-Test: \nvalue")).toThrow(/line break or NUL/);
    expect(() => parseHeader("X-Test: value\r\n")).toThrow(/line break or NUL/);
    expect(() => parseHeader("\nX-Test: value")).toThrow(/not a valid header name/);
    expect(() => parseHeader("X-Test\r: value")).toThrow(/not a valid header name/);
  });

  it("trims only spaces and tabs around the value (HTTP optional whitespace)", () => {
    expect(parseHeader("X-Test:\t value \t")).toEqual(["X-Test", "value"]);
    expect(parseHeader("  X-Test  : v")).toEqual(["X-Test", "v"]);
  });
});
