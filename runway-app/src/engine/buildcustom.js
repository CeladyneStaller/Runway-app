// ── One build function for every chart a person assembles ────────────────────────────────────────
//
// ⚠️ IT RETURNS THE SAME SPEC EVERY CURATED CHART RETURNS — `{ kind, x, ticks, series, format }`. That
// is the whole reason this is days rather than weeks: the picker, the renderer, the lens and the shared
// frame all work unchanged, because from their side a custom chart is just another chart.
//
// The strongest available test is in `buildcustom.test.js`: a config equivalent to `flow.inout` must
// produce the same series values as that chart's own `build`. If it can reproduce a curated chart it is
// correct for the whole family.

import { axisTicks, months } from "./charts.js";
import { measureById, overlaps, unitsOf, allowedTypes } from "./measures.js";
import { dimensionById, splitBy, tooManySeries } from "./dimensions.js";

const TONES = ["signal", "signal-2", "clay", "brown", "gate", "caution", "muted"];

/** The lines a dimension should split, for a given measure. */
function linesFor(measureId, parts, doc) {
  switch (measureId) {
    case "payroll": return parts?.employeeLines || [];
    case "opex": return (doc?.lines || []).filter(l => l.kind === "cost");
    case "projectSpend": return (parts?.projectLines || []).filter(l => l.kind === "cost");
    case "drawdowns": return (parts?.projectLines || []).filter(l => l.kind === "revenue");
    case "salesRev": return parts?.salesLines || [];
    case "capital": return parts?.roundLines || [];
    case "baseline": return parts?.baselineLines || [];
    // ⚠️ `cost` AND `rev` ARE PROJECTION TOTALS, not a line collection — they are the sum of every
    // source. Breaking them down means splitting ALL the compiled lines of that direction, which is
    // what the projection added up in the first place.
    case "cost": return [...(parts?.employeeLines || []), ...(parts?.projectLines || []).filter(l => l.kind === "cost"),
                         ...(doc?.lines || []).filter(l => l.kind === "cost"), ...(parts?.baselineLines || [])];
    case "rev": return [...(parts?.projectLines || []).filter(l => l.kind === "revenue"),
                        ...(parts?.salesLines || []), ...(parts?.saasLines || []), ...(parts?.roundLines || [])];
    default: return [];
  }
}

/**
 * @param cfg  { measures: [{id, type}], by: dimensionId|null, across: "month"|"category" }
 */
export function buildCustom(cfg, doc, parts, rows) {
  const ids = (cfg?.measures || []).map(m => m.id).filter(id => measureById(id));
  if (!ids.length) return null;

  // ⚠️ THE CHART WINDOW IS 18 MONTHS; THE PROJECTION IS 37 ROWS.
  //
  // Measures read the full projection — correctly, because that is where the numbers are — but every
  // curated chart draws `months(doc)`, which is `MONTHS_SHOWN`. Without this, a custom chart handed the
  // renderer 37 values against an 18-point axis: the extra half would have been drawn past the frame or
  // silently dropped depending on the shape, and nothing would have said which.
  //
  // The keystone test caught it by comparing lengths against a curated chart, which is exactly what it
  // was for.
  const x = months(doc);
  const win = x.length;
  const n = rows?.length || 0;
  const clip = (v) => (v || []).slice(0, win);
  const units = unitsOf(ids);
  const dim = cfg?.by ? dimensionById(cfg.by) : null;

  // ⚠️ A THIRD UNIT IS REFUSED RATHER THAN GIVEN A THIRD AXIS NOBODY CAN READ. Two is already a
  // compromise; three is a picture with no scale.
  if (units.length > 2) {
    return { kind: "lines", x: months(doc), ticks: axisTicks(doc), series: [], format: "money",
             note: "Too many different units on one chart — plot at most two." };
  }

  // ── one measure, broken down ──
  if (dim && ids.length === 1) {
    const split = splitBy(dim, linesFor(ids[0], parts, doc), n, doc);
    if (tooManySeries(1, split.length)) {
      return { kind: "lines", x: months(doc), ticks: axisTicks(doc), series: [], format: "money",
               note: `${split.length} series is more than a chart can show — remove the breakdown.` };
    }
    return finish(cfg, doc, split.map((s, i) => ({
      id: s.id, label: s.label, values: clip(s.values),
      // UNASSIGNED IS DRAWN GREY, not given a palette colour. It is an absence of assignment rather
      // than another project, and colouring it like one implies it is a peer.
      tone: s.unassigned ? "muted" : TONES[i % TONES.length],
    })), ids);
  }

  // ⚠️ SEVERAL MEASURES AND A BREAKDOWN IS REFUSED, not silently truncated. Three measures by eight
  // codes is twenty-four series produced by two entirely reasonable choices — the builder greys the
  // breakdown out, and this is the engine saying the same thing.
  if (dim && ids.length > 1) {
    return { kind: "lines", x: months(doc), ticks: axisTicks(doc), series: [], format: "money",
             note: "Pick one measure to break down, or drop the breakdown to plot several." };
  }

  // ── several measures, each its own series ──
  const series = ids.map((id, i) => {
    const m = measureById(id);
    return {
      id, label: m.label, values: clip(m.get(rows, parts, doc)),
      tone: TONES[i % TONES.length],
      // THE SECOND UNIT GETS THE RIGHT-HAND AXIS. Dollars and people on one scale is a coincidence of
      // magnitudes, not a chart.
      axis: units.length > 1 && m.unit === units[1] ? "right" : "left",
      shape: (cfg.measures.find(x => x.id === id) || {}).type || null,
    };
  });
  return finish(cfg, doc, series, ids);
}

function finish(cfg, doc, series, ids) {
  const ok = allowedTypes(ids);
  // ⚠️ THE TYPE FALLS BACK RATHER THAN DRAWING SOMETHING FALSE. If a saved chart asks for a stack that
  // its measures no longer allow — because one now contains another — it draws as lines and says so,
  // instead of asserting that the parts sum to the whole.
  const asked = cfg?.measures?.[0]?.type || "lines";
  const kind = ok.includes(asked) ? asked : (ok[0] || "lines");
  const over = overlaps(ids);
  return {
    kind: kind === "bars" ? "bars" : kind,
    x: months(doc), ticks: axisTicks(doc),
    series, format: "money",
    custom: true,
    note: kind !== asked && over.length
      ? `Drawn as ${kind}: these measures overlap, so stacking them would not add up.`
      : null,
  };
}
