/**
 * Dependency-free readers for the two archive formats a registry actually serves:
 * npm's `.tgz` (gzip'd tar) and PyPI's `.whl` (a zip). We parse both in pure Node so the
 * license ledger can inspect PUBLISHED artifacts without shelling out to `tar`/`unzip`
 * (not guaranteed on every runner) and without adding a dependency to a CLI whose whole
 * point in this change is a clean, auditable license surface.
 *
 * Only what the ledger needs is implemented: list entry names, and read one entry's bytes.
 */
import { gunzipSync, inflateRawSync } from 'node:zlib';

/* ── tar.gz ────────────────────────────────────────────────────────────────── */

/**
 * Parse a gzip'd POSIX tar into a Map of path -> Buffer.
 * Handles the ustar `prefix` field and GNU long names (`L` typeflag); skips
 * directories, PAX headers and other metadata entries.
 * @param {Buffer} tgz
 * @returns {Map<string, Buffer>}
 */
export function readTarGz(tgz) {
  const buf = gunzipSync(tgz);
  const out = new Map();
  let offset = 0;
  let longName = null;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;

    const name = cstr(header.subarray(0, 100));
    const size = octal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const prefix = cstr(header.subarray(345, 500));
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (typeflag === 'L') {
      // GNU long-name: the NEXT header's real name lives in this entry's body.
      longName = cstr(buf.subarray(dataStart, dataEnd));
    } else if (typeflag === '0' || typeflag === '\0') {
      const full = longName ?? (prefix ? `${prefix}/${name}` : name);
      longName = null;
      out.set(full, buf.subarray(dataStart, dataEnd));
    } else {
      longName = null;
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/* ── zip (.whl) ────────────────────────────────────────────────────────────── */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

/**
 * Parse a zip archive into a Map of path -> Buffer. Supports stored (0) and
 * deflate (8) — the only two methods pip/wheel emits.
 * @param {Buffer} zip
 * @returns {Map<string, Buffer>}
 */
export function readZip(zip) {
  const eocd = findEocd(zip);
  if (eocd < 0) throw new Error('not a zip archive: no end-of-central-directory record');

  const entryCount = zip.readUInt16LE(eocd + 10);
  let cd = zip.readUInt32LE(eocd + 16);
  const out = new Map();

  for (let i = 0; i < entryCount; i++) {
    if (zip.readUInt32LE(cd) !== CD_SIG) throw new Error(`corrupt central directory at entry ${i}`);
    const method = zip.readUInt16LE(cd + 10);
    const compressedSize = zip.readUInt32LE(cd + 20);
    const nameLen = zip.readUInt16LE(cd + 28);
    const extraLen = zip.readUInt16LE(cd + 30);
    const commentLen = zip.readUInt16LE(cd + 32);
    const localOffset = zip.readUInt32LE(cd + 42);
    const name = zip.subarray(cd + 46, cd + 46 + nameLen).toString('utf8');

    if (!name.endsWith('/')) {
      if (zip.readUInt32LE(localOffset) !== LFH_SIG) {
        throw new Error(`corrupt local header for ${name}`);
      }
      // The local header's own name/extra lengths are authoritative — they may differ
      // from the central directory's extra field.
      const lNameLen = zip.readUInt16LE(localOffset + 26);
      const lExtraLen = zip.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = zip.subarray(start, start + compressedSize);
      out.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    }

    cd += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function findEocd(buf) {
  // The EOCD is at most 22 + 65535 bytes from the end (comment field).
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function cstr(b) {
  const end = b.indexOf(0);
  return b.subarray(0, end === -1 ? b.length : end).toString('utf8');
}

function octal(b) {
  const s = cstr(b).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}
