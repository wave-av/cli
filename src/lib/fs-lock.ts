import { randomBytes } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Cross-process safety for the two small JSON files the CLI rewrites (~/.wave/config.json and
 * ~/.wave/credentials.json). Both are read-modify-write: without a lock, two `wave` processes (a
 * token refresh in one shell, `wave auth login --project b` in another) each read the same map
 * and the later write silently drops the other's change.
 */

/** A lock older than this belongs to a process that died holding it. */
const STALE_LOCK_MS = 30_000;
/** How long to wait for another `wave` process to finish its write. */
const LOCK_WAIT_MS = 10_000;

export interface FileLockOptions {
  staleMs?: number;
  waitMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));

const isErrno = (err: unknown, code: string) => (err as NodeJS.ErrnoException | null)?.code === code;

/** Which lock file this is: a lock removed and re-created differs in inode and/or mtime. */
const identityOf = (s: BigIntStats) => `${s.dev}-${s.ino}-${s.mtimeNs}`;

async function statLock(lockPath: string): Promise<BigIntStats | null> {
  try {
    return await stat(lockPath, { bigint: true });
  } catch (err) {
    if (isErrno(err, "ENOENT")) return null;
    throw err;
  }
}

/**
 * Remove `lockPath` if it is stale, without ever removing a lock someone else just took.
 *
 * Deciding "stale" and removing are two steps, so an unconditional rm() after the check races:
 * two processes both judge lock L0 stale, the first removes it and takes a fresh L1, and the
 * second's rm() then deletes L1, letting both into the section. Here the right to remove L0 is an
 * O_EXCL marker named after L0's identity (device, inode, mtime in ns): one process wins it,
 * re-checks under it that the lock file is still L0, and only then removes it. Everyone else goes
 * back to waiting. A late process that wins the marker after the winner released it finds the lock
 * is no longer L0 and removes nothing.
 *
 * Returns true when the lock is gone (removed here, or released meanwhile) and taking it can be
 * retried at once; false when the caller should wait.
 */
async function breakStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  const seen = await statLock(lockPath);
  if (!seen) return true;
  if (Date.now() - Number(seen.mtimeMs) <= staleMs) return false;

  const identity = identityOf(seen);
  const marker = `${lockPath}.${identity}.break`;
  let handle: FileHandle;
  try {
    handle = await open(marker, "wx", 0o600);
  } catch (err) {
    if (isErrno(err, "EEXIST")) return false; // another process is removing this same stale lock
    throw err;
  }
  await handle.close();
  try {
    const current = await statLock(lockPath);
    if (!current) return true;
    if (identityOf(current) !== identity) return false; // replaced by a live holder's fresh lock
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await rm(marker, { force: true });
  }
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

/** Remove the lock only if it is still ours (a stalled holder may have been taken over). */
async function releaseIfOwned(lockPath: string, stamp: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(lockPath, "utf-8");
  } catch (err) {
    if (isErrno(err, "ENOENT")) return;
    throw err;
  }
  if (content === stamp) await rm(lockPath, { force: true });
}

/**
 * Run `fn` while holding `<target>.lock`, an exclusive-create lockfile (O_CREAT|O_EXCL, atomic on
 * every local filesystem). Waits for a live holder, takes over a stale one (see breakStaleLock),
 * and always releases the lock it holds, never one it no longer owns.
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
    await releaseIfOwned(lockPath, stamp);
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
