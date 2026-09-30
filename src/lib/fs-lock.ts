import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
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

/**
 * Run `fn` while holding `<target>.lock`, an exclusive-create lockfile (O_CREAT|O_EXCL, atomic on
 * every local filesystem). Waits for a live holder, takes over a stale one, and always releases.
 */
export async function withFileLock<T>(
  target: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const staleMs = options.staleMs ?? STALE_LOCK_MS;
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const lockPath = `${target}.lock`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });

  const deadline = Date.now() + waitMs;
  let delay = 10;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${process.pid}\n`);
      } finally {
        await handle.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        const held = await stat(lockPath);
        if (Date.now() - held.mtimeMs > staleMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // released between our open() and stat(): try again at once
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Another wave process is still writing ${target} (lock: ${lockPath}). Retry in a moment; ` +
            "if no other wave command is running, delete the lock file.",
        );
      }
      await sleep(delay);
      delay = Math.min(delay * 2, 200);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
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
