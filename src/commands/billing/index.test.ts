import { describe, expect, it } from "vitest";
import { periodRange } from "./index.js";

/** `wave billing usage --period` -> the from/to GET /v1/billing/usage takes (UTC calendar months). */
describe("periodRange", () => {
  it("current: no range, so the server applies its own default (start of month .. today)", () => {
    expect(periodRange("current", new Date("2026-09-30T23:59:59Z"))).toEqual({});
  });

  it("previous: the whole previous calendar month", () => {
    expect(periodRange("previous", new Date("2026-09-30T12:00:00Z"))).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("previous from January rolls back into December of the prior year", () => {
    expect(periodRange("previous", new Date("2026-01-15T00:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("previous from March ends on the last day of February, leap year or not", () => {
    expect(periodRange("previous", new Date("2028-03-01T00:00:00Z"))).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("previous", new Date("2026-03-31T23:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("uses UTC, not the machine's local date, at a month boundary", () => {
    // 00:30 UTC on Oct 1 is still Sep 30 in the Americas; the billing month is October's.
    expect(periodRange("previous", new Date("2026-10-01T00:30:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("rejects anything else with the accepted values", () => {
    expect(() => periodRange("last-month")).toThrow(/Invalid --period "last-month". Expected one of: current, previous./);
  });
});
