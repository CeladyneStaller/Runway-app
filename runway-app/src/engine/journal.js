// THE PROJECTION JOURNAL — the honest sequel to the confidence band.
//
// The band today brackets the runway using the confidence TIERS plus measured burn variance. What it
// cannot do is tell you how good your forecasts actually are, because the app has never stored what it
// predicted. This module fixes that at the root: it records, over time, what the forecast SAID, so that
// later the app can compare each prediction against what actually happened.
//
// That comparison is what would earn a genuinely statistical band (Phase 3) — and, just as valuably, a
// measure of BIAS: not merely "how wide is my uncertainty" but "I consistently land 12% below my
// three-month forecast." You cannot compute either without a record, and the record can only be built
// by starting. Nothing here computes statistics yet; this is the recorder, and the clock starts when
// it ships.
//
// WHAT IS HONESTLY MEASURABLE, AND WHAT IS NOT. A snapshot taken in March and compared to June's real
// cash mixes two different things: the forecast being wrong, and the PLAN having changed (you hired
// someone, a grant landed, you cut a contractor). Those are not the same failure and no amount of
// arithmetic separates them after the fact. We do not pretend otherwise — this is "plan versus reality",
// not pure forecast error, and the UI says so.
//
// The WEEKLY cadence is what makes that honest framing workable rather than a cop-out. Two snapshots
// seven days apart cannot differ because a quarter of reality unfolded; if the curve moves that fast,
// the plan moved. Nobody plans and hires inside a week. Monthly snapshots would smear a plan change and
// a forecast miss into one indistinguishable jump; weekly ones keep them separable by construction.

import { uid } from "./time.js";

export const SNAPSHOT_CADENCE_DAYS = 7;
// Weekly for a decade. Effectively no ceiling in practice, but unbounded growth in a document that gets
// serialised on every save is not something to leave to chance.
export const JOURNAL_CAP = 600;

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();

// Which projection month index a given wall-clock date falls in, relative to the projection start.
// Snapshots need this so a forecast can later be indexed by LEAD TIME (how far ahead it was looking)
// rather than by absolute month, which is what makes short-horizon error measurable early.
export function monthIndexAt(now, startY, startM) {
  const d = now instanceof Date ? now : new Date(now);
  return (d.getFullYear() - startY) * 12 + (d.getMonth() - startM);
}

// A snapshot is a compact DIGEST, not a copy of the document. Storing the whole doc would be both
// enormous and useless: replaying an old document through today's engine measures the engine, not the
// forecast. What matters is the number the user was actually shown.
//
// `rows` must be the ANCHORED rows — the curve on screen — because that is what was predicted. The
// toggles ride along because a forecast made with speculative revenue on is not comparable to one made
// with it off, and Phase 2 must compare like with like.
export function makeSnapshot({ rows, toggles, cash, startY, startM, now = new Date(), auto = true }) {
  const curve = (rows || []).map(r => Math.round(r.start));   // whole dollars: no float noise, smaller JSON
  const last = (rows || [])[(rows || []).length - 1];
  return {
    id: uid(),
    takenAt: iso(now),
    atMonth: monthIndexAt(now, startY, startM),
    auto,
    toggles: {
      committed: !!toggles?.committed,
      expected: !!toggles?.expected,
      speculative: !!toggles?.speculative,
      financing: !!toggles?.financing,
    },
    cash: Math.round(Number(cash) || 0),
    curve,
    end: last ? Math.round(last.end) : 0,
    zeroMonths: zeroOfCurve(curve),
  };
}

// The predicted crossing, derived from the stored curve so a snapshot is self-contained (it never has
// to be re-derived from a document that has since moved on). Linear within the month, matching zeroInfo.
export function zeroOfCurve(curve) {
  if (!curve || !curve.length) return null;
  if (curve[0] <= 0) return 0;
  for (let m = 1; m < curve.length; m++) {
    if (curve[m] <= 0) {
      const a = curve[m - 1], b = curve[m];
      const f = a === b ? 0 : a / (a - b);
      return +(m - 1 + f).toFixed(3);
    }
  }
  return null;                      // never runs dry within the horizon
}

// Is another snapshot due? Compared against the most recent entry, so a fresh document takes one
// immediately and thereafter it settles into the weekly rhythm.
export function dueForSnapshot(journal, now = new Date(), cadenceDays = SNAPSHOT_CADENCE_DAYS) {
  const list = journal || [];
  if (!list.length) return true;
  const latest = list.reduce((a, s) => (s.takenAt > a.takenAt ? s : a), list[0]);
  const age = (new Date(now).getTime() - new Date(latest.takenAt).getTime()) / DAY_MS;
  return age >= cadenceDays;
}

// A brand-new empty document has nothing worth recording, and a journal full of zeroes would poison the
// error statistics later with observations that were never really forecasts.
export function worthSnapshotting({ cash, rows }) {
  if ((Number(cash) || 0) > 0) return true;
  return (rows || []).some(r => (r.cost || 0) !== 0 || (r.rev || 0) !== 0);
}

export function appendSnapshot(journal, snap, cap = JOURNAL_CAP) {
  const next = [...(journal || []), snap];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function removeSnapshot(journal, id) {
  return (journal || []).filter(s => s.id !== id);
}

// What this snapshot predicted for a given projection month. Null when the month falls outside the
// horizon it could see.
export function forecastAt(snap, m) {
  if (!snap || !snap.curve) return null;
  return m >= 0 && m < snap.curve.length ? snap.curve[m] : null;
}

// How far apart two forecasts are, over the months they both covered. Paired with the days between
// them, this is what separates a plan change from a forecast miss: a large delta across a few days is
// the plan moving, because reality does not move that fast. Phase 2 turns this into a real signal;
// exposing it now keeps the weekly cadence honest rather than decorative.
export function planDelta(a, b) {
  if (!a?.curve || !b?.curve) return null;
  const from = Math.max(a.atMonth, b.atMonth, 0);   // only the still-future part of both
  const to = Math.min(a.curve.length, b.curve.length);
  let max = 0;
  for (let m = from; m < to; m++) max = Math.max(max, Math.abs(a.curve[m] - b.curve[m]));
  const days = Math.abs(new Date(b.takenAt) - new Date(a.takenAt)) / DAY_MS;
  return { maxAbs: Math.round(max), days: +days.toFixed(2) };
}

export const sortedJournal = (journal) =>
  [...(journal || [])].sort((x, y) => (x.takenAt < y.takenAt ? 1 : -1));   // newest first
