import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withFileLock, writeFileAtomic } from "./fs-lock.js";

let dir: string;

/** The identity fs-lock names a lock's removal markers after (device, inode, mtime in ns). */
function identityOf(path: string): string {
  const s = statSync(path, { bigint: true });
  return `${s.dev}-${s.ino}-${s.mtimeNs}`;
}

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

  it("lets exactly one of several processes recovering the same stale lock in at a time", async () => {
    // Review finding (PR #86): two recoverers both judged the old lock stale; one removed it and
    // took a fresh lock, then the other's unconditional rm() deleted that fresh lock and both
    // entered the section. Every contender here starts against the same aged lock.
    const target = join(dir, "f.json");
    writeFileSync(`${target}.lock`, "99999\n");
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(`${target}.lock`, old, old);

    let active = 0;
    let maxActive = 0;
    const contender = () =>
      withFileLock(
        target,
        async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
        },
        { staleMs: 30_000, waitMs: 5_000 },
      );
    await Promise.all(Array.from({ length: 8 }, contender));
    expect(maxActive).toBe(1);
    expect(readdirSync(dir)).toEqual([]); // no lock and no break marker left behind
  });

  it("does not delete a lock it no longer owns when it releases", async () => {
    const target = join(dir, "f.json");
    await withFileLock(target, async () => {
      // Simulate a takeover while this holder was stalled (e.g. a laptop suspended mid-write).
      rmSync(`${target}.lock`);
      writeFileSync(`${target}.lock`, "12345 someone-else\n");
    });
    expect(readFileSync(`${target}.lock`, "utf-8")).toBe("12345 someone-else\n");
  });

  it("recovers a stale lock even when a process died holding its removal marker", async () => {
    // Review finding (PR #86): a recoverer killed between creating the `.break` marker and removing
    // it left the marker behind, and every later recovery of that lock waited and failed.
    const target = join(dir, "f.json");
    const lock = `${target}.lock`;
    writeFileSync(lock, "99999 dead-holder\n");
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(lock, old, old);
    const marker = `${lock}.${identityOf(lock)}.0.break`;
    writeFileSync(marker, "");
    utimesSync(marker, old, old); // the recoverer that made it died two minutes ago

    expect(await withFileLock(target, async () => "ok", { staleMs: 30_000, waitMs: 2_000 })).toBe("ok");
    expect(readdirSync(dir)).toEqual([]); // stale lock, dead marker and our own marker all gone
  });

  it("waits instead of breaking in while a live process holds the removal marker", async () => {
    const target = join(dir, "f.json");
    const lock = `${target}.lock`;
    writeFileSync(lock, "99999 dead-holder\n");
    const old = (Date.now() - 120_000) / 1000;
    utimesSync(lock, old, old);
    const marker = `${lock}.${identityOf(lock)}.0.break`;
    writeFileSync(marker, ""); // fresh: another process is removing this lock right now

    await expect(
      withFileLock(target, async () => "never", { staleMs: 30_000, waitMs: 100 }),
    ).rejects.toThrow(/Another wave process is still writing/);
    expect(readFileSync(lock, "utf-8")).toBe("99999 dead-holder\n");
  });

  it("releases through the removal marker, so it never races a recoverer replacing its lock", async () => {
    // Review finding (PR #86): a holder that read its own stamp could rm() the path just after a
    // recoverer replaced the lock, deleting the recoverer's fresh lock. Release now needs the same
    // marker as recovery: while a recoverer holds it, the holder leaves removal to the recoverer.
    const target = join(dir, "f.json");
    const lock = `${target}.lock`;
    let marker = "";
    await withFileLock(target, async () => {
      marker = `${lock}.${identityOf(lock)}.0.break`;
      writeFileSync(marker, ""); // a recoverer is mid-removal of this very lock
    });
    expect(readFileSync(lock, "utf-8")).toMatch(/^\d+ [0-9a-f]{24}\n$/); // left to the recoverer
    rmSync(marker);
  });

  it("returns the section's result even when releasing the lock fails", async () => {
    // Review finding (PR #86): a release error thrown from `finally` replaced a successful result,
    // so a saved credential was reported as a failure.
    const target = join(dir, "f.json");
    const lock = `${target}.lock`;
    const warnings: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    });
    try {
      const result = await withFileLock(target, async () => {
        // Make the release fail: the lock path is now a directory, which cannot be read as a stamp.
        rmSync(lock);
        mkdirSync(lock);
        return "saved";
      });
      expect(result).toBe("saved");
    } finally {
      spy.mockRestore();
    }
    expect(warnings.join("")).toMatch(/could not remove the lock file .*f\.json\.lock/);
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
