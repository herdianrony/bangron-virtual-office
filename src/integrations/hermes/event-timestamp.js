// Shared, deterministic timestamp parsing for Hermes event ingestion.
//
// Supported input formats (explicit contract — nothing else is accepted):
//   1. Unix seconds: integer or fractional number / string (1e9 .. 1e10-1).
//      Fractional seconds (e.g. 1795242296.5631661) are the native Hermes
//      SSE API Server timestamp format; sub-second precision is floored.
//   2. Unix milliseconds: integer number or 13-digit string (1e12 .. 1e13-1).
//   3. ISO-8601 with explicit time and zone: YYYY-MM-DDTHH:MM:SS[.frac](Z|±HH:MM).
//      This is the native Hermes outbound-webhook format (agent/shell_hooks.py
//      _utc_now_iso → datetime.now(tz=UTC).isoformat() with +00:00 → Z).
//
// Returns epoch milliseconds, or null for missing/unsupported/invalid input.
// Calendar rollover (e.g. 2026-02-30) is rejected, never silently normalized.
// Same input always yields the same output (no Date.now() inside).

const UNIX_SEC_RE = /^\d{10}$/;
const UNIX_MS_RE = /^\d{13}$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

export function parseEventTimestamp(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value >= 1e9 && value < 1e10) return Math.floor(value * 1000); // unix seconds (fractional allowed)
    if (value >= 1e12 && value < 1e13 && Number.isInteger(value)) return value; // unix milliseconds
    return null; // ambiguous magnitudes are rejected, not guessed
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (s === '') return null;
  if (/^\d{10}(\.\d+)?$/.test(s)) return Math.floor(Number(s) * 1000); // unix seconds (fractional allowed)
  if (UNIX_MS_RE.test(s)) return Number(s);

  const m = s.match(ISO_RE);
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, frac, tz] = m;
  const year = Number(ys);
  const month = Number(mos);
  const day = Number(ds);
  const hour = Number(hs);
  const minute = Number(mis);
  const second = Number(ss);
  const ms = frac ? Number(frac.padEnd(3, '0').slice(0, 3)) : 0;

  // Build the wall-clock time as UTC, then reject any component that rolled
  // over (Feb 30 → Mar 2, month 13, hour 25, ...). This keeps validation
  // correct for non-Z offsets too, where the UTC date legitimately differs.
  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (
    wall.getUTCFullYear() !== year ||
    wall.getUTCMonth() !== month - 1 ||
    wall.getUTCDate() !== day ||
    wall.getUTCHours() !== hour ||
    wall.getUTCMinutes() !== minute ||
    wall.getUTCSeconds() !== second
  ) {
    return null;
  }

  let offsetMinutes = 0;
  if (tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1;
    const oh = Number(tz.slice(1, 3));
    const om = Number(tz.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMinutes = sign * (oh * 60 + om);
  }
  return wall.getTime() - offsetMinutes * 60000;
}

export default { parseEventTimestamp };
