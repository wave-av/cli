import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { BigIntStats, Stats } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deterministic replay of the stale-lock takeover race (PR #86 review): a recoverer observed the
 * old lock L0 as stale, but by the time it acts a live process has replaced L0 with a fresh L1.
 * The first stat() of the lock is made to report an aged file, exactly what a process that looked
 * just before the replacement saw; every later stat() is real.
 */
const agedStatsPending = { count: 0 };

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const stat = async (...args: Parameters<typeof actual.stat>) => {
    const real = (await actual.stat(...args)) as Stats | BigIntStats;
    const path = String(args[0]);
    if (!path.endsWith(".lock") || agedStatsPending.count === 0) return real;
    agedStatsPending.count -= 1;
    const aged = Object.assign(Object.create(Object.getPrototypeOf(real)), real);
    if (typeof real.mtimeMs === "bigint") {
      aged.mtimeMs = (real as BigIntStats).mtimeMs - 120_000n;
      aged.mtimeNs = (real as BigIntStats).mtimeNs - 120_000_000_000n;
    } else {
      aged.mtimeMs = (real as Stats).mtimeMs - 120_000;
    }
    return aged;
  };
  return { ...actual, stat, default: { ...actual, stat } };
});

const { withFileLock } = await import("./fs-lock.js");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wave-cli-lock-race-"));
  agedStatsPending.count = 0;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withFileLock stale takeover", () => {
  it("never removes a fresh lock that replaced the stale one it observed", async () => {
    const target = join(dir, "credentials.json");
    let active = 0;
    let maxActive = 0;
    const section = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 60));
      active -= 1;
    };

    let holderInside!: () => void;
    const holderEntered = new Promise<void>((r) => (holderInside = r));
    const holder = withFileLock(target, async () => {
      holderInside();
      await section();
    });
    await holderEntered;

    // The recoverer's first look at the (fresh, held) lock reports it as two minutes old.
    agedStatsPending.count = 1;
    const recoverer = withFileLock(target, section, { staleMs: 30_000, waitMs: 5_000 });

    await Promise.all([holder, recoverer]);
    expect(agedStatsPending.count).toBe(0); // the aged view was actually consumed
    expect(maxActive).toBe(1);
    expect(readdirSync(dir)).toEqual([]); // lock and break marker both cleaned up
  });
});
