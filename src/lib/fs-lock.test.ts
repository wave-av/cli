import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withFileLock, writeFileAtomic } from "./fs-lock.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wave-cli-lock-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("withFileLock", () => {
  it("serializes overlapping read-modify-write sections", async () => {
    const target = join(dir, "counter.json");
    writeFileSync(target, "0");
    const bump = () =>
      withFileLock(target, async () => {
        const n = Number(readFileSync(target, "utf-8"));
        await new Promise((r) => setTimeout(r, 2)); // widen the race window
        writeFileSync(target, String(n + 1));
      });
    await Promise.all(Array.from({ length: 20 }, bump));
    expect(readFileSync(target, "utf-8")).toBe("20");
    expect(readdirSync(dir)).toEqual(["counter.json"]); // lock released every time
  });

  it("releases the lock when the section throws", async () => {
    const target = join(dir, "f.json");
    await expect(withFileLock(target, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await withFileLock(target, async () => "again")).toBe("again");
  });

  it("takes over a lock left behind by a dead process", async () => {
    const target = join(dir, "f.json");
    writeFileSync(`${target}.lock`, "99999\n");
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(`${target}.lock`, old, old);
    expect(await withFileLock(target, async () => "ok", { staleMs: 30_000, waitMs: 500 })).toBe("ok");
  });

  it("gives up with an actionable error while a live holder keeps the lock", async () => {
    const target = join(dir, "f.json");
    writeFileSync(`${target}.lock`, `${process.pid}\n`);
    await expect(withFileLock(target, async () => "never", { waitMs: 50 })).rejects.toThrow(
      /Another wave process is still writing .*delete the lock file/,
    );
  });
});

describe("writeFileAtomic", () => {
  it("replaces the file with exactly the requested mode and leaves no temp file", async () => {
    const target = join(dir, "credentials.json");
    writeFileSync(target, "{}", { mode: 0o644 });
    await writeFileAtomic(target, '{"a":"b"}', 0o600);
    expect(readFileSync(target, "utf-8")).toBe('{"a":"b"}');
    if (process.platform !== "win32") expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual(["credentials.json"]);
  });
});
