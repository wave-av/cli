import { randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Cross-process safety for the two small JSON files the CLI rewrites (~/.wave/config.json and
 * ~/.wave/credentials.json). Both are read-modify-write: without a lock, two `wave` processes (a
 * token refresh in one shell, `wave auth login --project b` in another) each read the same map
 * and the later write silently drops the other's change.
 */

/** A lock (or removal marker) older than this belongs to a process that died holding it. */
const STALE_LOCK_MS = 30_000;
/** How long to wait for another `wave` process to finish its write. */
const LOCK_WAIT_MS = 10_000;
/**
 * Removal markers tried per lock file (see removeLock). Marker n+1 is only ever taken because the
 * holder of marker n died in the few milliseconds it held it, so in practice marker 0 is the only
 * one used; the bound keeps a directory full of dead markers from being walked forever.
 */
const MAX_REMOVAL_MARKERS = 8;

export interface FileLockOptions {
  staleMs?: number;
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

const isErrno = (err: unknown, code: string) => (err as NodeJS.ErrnoException | null)?.code === code;

/** Which lock file this is: a lock removed and re-created differs in inode and/or mtime. */
const identityOf = (s: BigIntStats) => `${s.dev}-${s.ino}-${s.mtimeNs}`;

/** stat() with bigint times; null when the file does not exist. */
async function statOrNull(path: string): Promise<BigIntStats | null> {
  try {
    return await stat(path, { bigint: true });
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
}

const isOlderThan = (s: BigIntStats, ms: number) => Date.now() - Number(s.mtimeMs) > ms;

/** Create `path` exclusively (an empty marker file); false when it already exists. */
async function takeMarker(path: string): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (err) {
    if (isErrno(err, "EEXIST")) return false;
    throw err;
  }
  // The marker is held from the moment it exists; an empty file has nothing a failed close loses.
  await handle.close().catch(() => undefined);
  return true;
}

/**
 * Remove the lock file whose identity (device, inode, mtime in ns) is `identity`, and never any
 * other file that is at `lockPath` by then.
 *
 * Looking at a lock and removing it are two steps, so a bare rm() by path races. Two processes
 * both judge lock L0 stale; the first removes it and takes a fresh L1; the second's rm() then
 * deletes L1 and both are in the section. A holder that stalled past `staleMs` and releases L0
 * just as a recoverer replaces it does the same. So the right to remove L0 is an O_EXCL marker
 * named after L0's identity: whoever takes it re-checks under it that the file is still L0, and
 * only then removes it. Stale-lock recovery and release both come through here, so they exclude
 * each other as well.
 *
 * A process can die holding a marker (killed in the milliseconds between taking and dropping it).
 * A single marker would then block every later recovery of L0 until someone deleted files by hand,
 * so markers are numbered: one older than `staleMs` belongs to a dead process and the next process
 * takes the next number. Once L0 is gone no lock file can have its identity again, so every marker
 * named after it is litter, and the process that saw L0 gone removes them; a process that takes
 * one of those numbers later re-checks, finds L0 gone, and removes nothing.
 *
 * Returns "gone" when L0 is no longer at `lockPath` (removed here, or already removed or replaced)
 * and "busy" when a live process holds L0's marker, so the caller should wait and look again.
 */
async function removeLock(
  lockPath: string,
  identity: string,
  staleMs: number,
): Promise<"gone" | "busy"> {
  const markerPath = (n: number) => `${lockPath}.${identity}.${n}.break`;
  let taken = -1;
  for (let n = 0; n < MAX_REMOVAL_MARKERS; n++) {
    if (await takeMarker(markerPath(n))) {
      taken = n;
      break;
    }
    const marker = await statOrNull(markerPath(n));
    // Dropped meanwhile (its holder just finished) or fresh (a live process is on it): wait.
    if (!marker || !isOlderThan(marker, staleMs)) return "busy";
    // Older than staleMs: its holder died while removing. Try the next number.
  }
  if (taken < 0) return "busy";

  let lockGone = false;
  try {
    const current = await statOrNull(lockPath);
    if (current && identityOf(current) === identity) await rm(lockPath, { force: true });
    lockGone = true;
    return "gone";
  } finally {
    // L0 gone: every marker named after it is litter. Otherwise drop only the one taken here.
    const lowest = lockGone ? 0 : taken;
    for (let n = taken; n >= lowest; n--) {
      await rm(markerPath(n), { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Remove `lockPath` if it is stale, never a lock someone else just took (see removeLock).
 * Returns true when the lock is gone and taking it can be retried at once; false when the caller
 * should wait.
 */
async function breakStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  const seen = await statOrNull(lockPath);
  if (!seen) return true;
  if (!isOlderThan(seen, staleMs)) return false;
  return (await removeLock(lockPath, identityOf(seen), staleMs)) === "gone";
}

/** Create the lock file exclusively; false when another process holds it. */
async function tryAcquire(lockPath: string, stamp: string): Promise<boolean> {
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (err) {
    if (isErrno(err, "EEXIST")) return false;
    throw err;
  }
  try {
    await handle.writeFile(stamp);
  } catch (err) {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }); // ours, just created: do not leave it to go stale
    throw err;
  }
  await handle.close();
  return true;
}

/**
 * Remove the lock only if it is still ours. A holder that stalled past staleMs may have been taken
 * over, and a recoverer may be replacing its lock at this very moment, so the stamp proves
 * ownership and the removal itself goes through removeLock (under the lock's marker, with a
 * re-check), never a bare rm() by path.
 */
async function releaseIfOwned(lockPath: string, stamp: string, staleMs: number): Promise<void> {
  let handle: FileHandle;
  try {
    handle = await open(lockPath, "r");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return; // already removed by a recoverer
    throw err;
  }
  let identity: string;
  let content: string;
  try {
    // Identity and stamp from one open file, so they describe the same lock file.
    identity = identityOf(await handle.stat({ bigint: true }));
    content = await handle.readFile("utf-8");
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (content !== stamp) return; // a recoverer replaced it: not ours to remove
  // "busy" means a recoverer holds this lock's marker and removes it itself.
  await removeLock(lockPath, identity, staleMs);
}

/**
 * Run `fn` while holding `<target>.lock`, an exclusive-create lockfile (O_CREAT|O_EXCL, atomic on
 * every local filesystem). Waits for a live holder, takes over a stale one (see breakStaleLock),
 * and releases the lock it holds, never one it no longer owns.
 */
export async function withFileLock<T>(
  target: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? STALE_LOCK_MS;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const lockPath = `${target}.lock`;
  // pid for a human reading the file; the random token is what proves ownership on release.
  const stamp = `${process.pid} ${randomBytes(12).toString("hex")}\n`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  const deadline = Date.now() + waitMs;
  let delay = 10;
  while (!(await tryAcquire(lockPath, stamp))) {
    if (await breakStaleLock(lockPath, staleMs)) continue;
    if (Date.now() >= deadline) {
      throw new Error(
        `Another wave process is still writing ${target} (lock: ${lockPath}). Retry in a moment; ` +
          "if no other wave command is running, delete the lock file.",
      );
    }
    // Jittered: waiters that started together must not wake together. Without jitter every
    // waiter slept the same 10, 20, 40 … 200ms schedule, so each release was followed by one
    // winner and a herd sleeping another full 200ms (24 queued writers took ~4.2s).
    await sleep(delay / 2 + Math.random() * (delay / 2));
    delay = Math.min(delay * 2, 100);
  }

  try {
    return await fn();
  } finally {
    // By now `fn` has written (or failed) and that outcome must stand: a release that fails must
    // not turn a saved credential into a reported failure. The lock left behind goes stale and the
    // next writer recovers it (breakStaleLock); say so rather than fail silently.
    await releaseIfOwned(lockPath, stamp, staleMs).catch((err: unknown) => {
      process.stderr.write(
        `Warning: could not remove the lock file ${lockPath} (${(err as Error)?.message ?? err}). ` +
          `It counts as abandoned ${Math.round(staleMs / 1000)}s after it was taken, and the next ` +
          "wave command then removes it.\n",
      );
    });
  }
}

/**
 * Replace `path` in one step: write a uniquely named sibling, then rename it over the target. A
 * reader never sees a half-written file, and concurrent writers never share a temp file. `mode`
 * (e.g. 0o600 for credentials) is applied before the rename, so the file is never looser.
 */
export async function writeFileAtomic(path: string, data: string, mode?: number): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, data, mode === undefined ? "utf-8" : { encoding: "utf-8", mode });
    // writeFile's mode is filtered by the umask; set it exactly.
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
