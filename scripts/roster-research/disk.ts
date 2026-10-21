import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statfsSync, statSync, unlinkSync, writeFileSync } from "node:fs";

/** Below this much free space a run stops cleanly instead of crashing half-way through a write. 1 GiB; ROSTER_MIN_FREE_MB overrides it. */
export const MIN_FREE_BYTES = (() => {
  const mb = Number(process.env.ROSTER_MIN_FREE_MB);
  return Number.isFinite(mb) && mb > 0 ? mb * 1048576 : 1024 * 1024 * 1024;
})();

export class LowDiskError extends Error {
  readonly freeBytes: number;
  constructor(freeBytes: number, where = "") {
    super(`Disk almost full (${Math.floor(freeBytes / 1048576)} MB free${where ? ` at ${where}` : ""}). Free some space, then re-run the same command to resume: pages already collected are kept and are not fetched again.`);
    this.name = "LowDiskError";
    this.freeBytes = freeBytes;
  }
}

/** Free bytes available to this user on the disk holding `dir` (the folder is created if needed). */
export function freeBytes(dir: string): number {
  mkdirSync(dir, { recursive: true });
  const s = statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

/** Throws LowDiskError when less than `min` bytes are free. `free` is injectable for tests. */
export function checkDisk(dir: string, min = MIN_FREE_BYTES, free: (d: string) => number = freeBytes): void {
  const f = free(dir);
  if (f < min) throw new LowDiskError(f, dir);
}

/**
 * Writes to a temporary file in the same folder, then renames it over the target. A full disk or a crash leaves either the old
 * file or the new one, never a half-written one. A write that fails for lack of space becomes a LowDiskError.
 */
export function atomicWriteFileSync(file: string, data: string | Uint8Array): void {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* nothing more to clean up */
    }
    if ((e as NodeJS.ErrnoException)?.code === "ENOSPC") throw new LowDiskError(0, file);
    throw e;
  }
}

/** Appends one line. A write that fails for lack of space becomes a LowDiskError. */
export function appendLineSync(file: string, line: string): void {
  try {
    appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOSPC") throw new LowDiskError(0, file);
    throw e;
  }
}

/** If a crash or a full disk left an append-only file without its final newline, add it so the next line does not glue onto the broken one. */
export function repairTrailingLine(file: string): boolean {
  if (!existsSync(file)) return false;
  const size = statSync(file).size;
  if (size === 0) return false;
  const fd = openSync(file, "r");
  const b = Buffer.alloc(1);
  try {
    readSync(fd, b, 0, 1, size - 1);
  } finally {
    closeSync(fd);
  }
  if (b[0] === 0x0a) return false;
  appendFileSync(file, "\n");
  return true;
}
