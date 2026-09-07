import { describe, expect, it } from "vitest";
import { getNestedValue, parseConfigPath, setNestedValue } from "./index.js";
import { getDefaultConfig, waveConfigSchema } from "../../lib/config/schema.js";

/**
 * Security regression test for CodeQL js/prototype-pollution-utility (alert #2).
 *
 * `wave config set <key> <value>` passes an argv-controlled key into setNestedValue, which
 * split it on "." and walked/created each container. `__proto__` is an object, so the walk
 * descended into Object.prototype and assigned onto it.
 */
describe("config path guards", () => {
  for (const forbidden of ["__proto__", "constructor", "prototype"]) {
    it(`rejects "${forbidden}" as a leading path segment`, () => {
      expect(() => parseConfigPath(`${forbidden}.polluted`)).toThrow(/reserved property name/);
    });

    it(`rejects "${forbidden}" as a nested path segment`, () => {
      expect(() => parseConfigPath(`telemetry.${forbidden}.polluted`)).toThrow(
        /reserved property name/,
      );
    });
  }

  it("rejects empty paths and empty segments", () => {
    expect(() => parseConfigPath("")).toThrow(/must not be empty/);
    expect(() => parseConfigPath("a..b")).toThrow(/empty path segment/);
  });

  it("accepts ordinary dotted keys", () => {
    expect(parseConfigPath("telemetry.enabled")).toEqual(["telemetry", "enabled"]);
  });
});

describe("setNestedValue prototype pollution", () => {
  it("does not pollute Object.prototype via __proto__", () => {
    const target: Record<string, unknown> = {};

    expect(() => setNestedValue(target, "__proto__.polluted", "yes")).toThrow();

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("does not pollute via constructor.prototype", () => {
    const target: Record<string, unknown> = {};

    expect(() => setNestedValue(target, "constructor.prototype.polluted", "yes")).toThrow();

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("does not pollute via a nested __proto__ segment", () => {
    const target: Record<string, unknown> = { a: {} };

    expect(() => setNestedValue(target, "a.__proto__.polluted", "yes")).toThrow(
      /reserved property name/,
    );

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect((target["a"] as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not pollute via a nested constructor.prototype segment", () => {
    const target: Record<string, unknown> = { a: {} };

    expect(() => setNestedValue(target, "a.constructor.prototype.polluted", "yes")).toThrow(
      /reserved property name/,
    );

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects a reserved key in the final (written) segment too", () => {
    const target: Record<string, unknown> = {};

    for (const forbidden of ["__proto__", "constructor", "prototype"]) {
      expect(() => setNestedValue(target, `telemetry.${forbidden}`, "yes")).toThrow(
        /reserved property name/,
      );
    }

    expect(Object.prototype).not.toHaveProperty("yes");
    expect(target).not.toHaveProperty("telemetry.__proto__");
  });

  it("creates intermediate containers with a null prototype", () => {
    const target: Record<string, unknown> = {};
    setNestedValue(target, "telemetry.nested.enabled", "true");

    const telemetry = target["telemetry"] as object;
    const nested = (telemetry as Record<string, unknown>)["nested"] as object;
    expect(Object.getPrototypeOf(telemetry)).toBeNull();
    expect(Object.getPrototypeOf(nested)).toBeNull();
    // A null-prototype container has nothing to pollute even if a guard were bypassed.
    expect(getNestedValue(target, "telemetry.nested.enabled")).toBe(true);
  });

  it("still sets ordinary nested values", () => {
    const target: Record<string, unknown> = {};
    setNestedValue(target, "telemetry.enabled", "true");
    expect(target).toEqual({ telemetry: { enabled: true } });
  });

  it("produces containers the config schema still validates", () => {
    // `config set` feeds its result straight into waveConfigSchema.parse via saveConfig,
    // so a null-prototype container must survive zod validation and JSON serialisation.
    const cfg = { ...getDefaultConfig() } as Record<string, unknown>;
    setNestedValue(cfg, "projects.acme.organizationId", "org_1");
    setNestedValue(cfg, "projects.acme.organizationName", "Acme");

    const validated = waveConfigSchema.parse(cfg);
    expect(validated.projects["acme"]?.organizationId).toBe("org_1");
    expect(JSON.parse(JSON.stringify(validated))).toMatchObject({
      projects: { acme: { organizationName: "Acme" } },
    });
  });

  it("round-trips through JSON so null-prototype containers stay serialisable", () => {
    const target: Record<string, unknown> = {};
    setNestedValue(target, "telemetry.enabled", "true");
    setNestedValue(target, "api.timeout", "30");
    expect(JSON.parse(JSON.stringify(target))).toEqual({
      telemetry: { enabled: true },
      api: { timeout: 30 },
    });
  });

  it("parses numbers and booleans, leaving other strings alone", () => {
    const target: Record<string, unknown> = {};
    setNestedValue(target, "a.n", "42");
    setNestedValue(target, "a.f", "false");
    setNestedValue(target, "a.s", "hello");
    expect(target["a"]).toEqual({ n: 42, f: false, s: "hello" });
  });
});

describe("getNestedValue", () => {
  it("refuses to read through the prototype chain", () => {
    expect(() => getNestedValue({}, "__proto__.constructor")).toThrow(/reserved property name/);
  });

  it("returns undefined for inherited properties rather than leaking them", () => {
    // `toString` exists on Object.prototype but is not config the user set.
    expect(getNestedValue({}, "toString")).toBeUndefined();
  });

  it("reads own nested values", () => {
    expect(getNestedValue({ telemetry: { enabled: true } }, "telemetry.enabled")).toBe(true);
  });
});
