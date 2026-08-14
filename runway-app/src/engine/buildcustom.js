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
import { colorsFor } from "./palette.js";
import { renderKind, axesFor } from "./charttype.js";

// ⚠️ THE PALETTE IS NO LONGER A CYCLING LIST OF TONE NAMES. Seven tones cycling by index gave four
// grants four near-identical greens — colour carrying the TYPE and losing the IDENTITY, which is
// backwards for a breakdown. `colorsFor` puts hue on the type and lightness on the member.
//
// Several MEASURES on one chart still cycle: they have no type, and their identity is their label.
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

  // ⚠️ BREAKDOWN IS PER DATASET NOW. Each measure splits on its own dimension, or on none — which is
  // what makes "spend split by project, with cash over it" expressible. The old builder had ONE
  // breakdown for the chart, so a split measure and an unsplit one could not coexist.
  const out = [];
  let colorIdx = 0;
  for (const spec of cfg.measures || []) {
    const m = measureById(spec.id);
    if (!m) continue;
    const dim = spec.by ? dimensionById(spec.by) : null;

    if (dim) {
      const split = splitBy(dim, linesFor(spec.id, parts, doc), n, doc);
      const colors = colorsFor(split, dim.typeOf ? (k) => dim.typeOf(k, doc) : null);
      split.forEach((sp, k) => out.push({
        id: `${spec.id}:${sp.id}`, label: `${sp.label}`, values: clip(sp.values),
        color: colors[k], tone: sp.unassigned ? "muted" : null,
        shape: spec.shape || "lines", stacked: !!spec.stacked, axis: spec.axis || "left",
        // THE GROUP IT CAME FROM, so a stack of one measure's parts does not merge with another's.
        group: spec.id,
      }));
    } else {
      out.push({
        id: spec.id, label: m.label, values: clip(m.get(rows, parts, doc)),
        tone: TONES[colorIdx++ % TONES.length],
        shape: spec.shape || "lines", stacked: !!spec.stacked, axis: spec.axis || "left",
        group: spec.id,
      });
    }
  }

  // ⚠️ THE CAP IS ON THE TOTAL, because two datasets each split eight ways is sixteen series produced
  // by two reasonable choices — the same trap as before, one level up.
  if (tooManySeries(1, out.length)) {
    return { kind: "lines", x, ticks: axisTicks(doc), series: [], format: "money",
             note: `${out.length} series is more than a chart can show — remove a breakdown.` };
  }
  return finish(cfg, doc, out, ids);
}

function finish(cfg, doc, series, ids) {
  const ok = allowedTypes(ids);
  // ⚠️ THE CHART KIND COMES FROM SHAPE + STACKED + ORIENTATION, not from a single type name. `Stack`
  // already renders FILLED PATHS rather than rects, so a stacked line was drawable all along — only
  // the way to ask for it was missing.
  // ⚠️ NO LONGER ONE KIND FOR THE CHART. Shape and stacking are carried on each series and resolved by
  // `Composite`; only ORIENTATION is chart-level, because it decides which axis the categories run
  // along and cannot differ per dataset.
  const kindFromControls = cfg?.orient === "y" ? "hbars" : "composite";
  const axes = axesFor((cfg?.measures || []).map(m => ({ ...measureById(m.id), axis: m.axis })));
  series = series.map(sr => {
    const m = (cfg?.measures || []).find(x => x.id === sr.id);
    return { ...sr,
             // PER-SERIES SHAPE AND STACKING, read by `Composite` — this is what lets obligations stack
             // while cash rides over them as a line, in one chart.
             shape: m?.shape || sr.shape || "lines",
             stacked: m?.stacked ?? sr.stacked ?? false,
             axis: axes.find(a => a.id === sr.id)?.axis || "left" };
  });
  // ⚠️ THE TYPE FALLS BACK RATHER THAN DRAWING SOMETHING FALSE. If a saved chart asks for a stack that
  // its measures no longer allow — because one now contains another — it draws as lines and says so,
  // instead of asserting that the parts sum to the whole.
  const kind = kindFromControls;
  const over = overlaps(ids);
  // TRUE BY CONSTRUCTION: un-stack any series whose measure contains or is contained by another, so the
  // note above describes what was drawn rather than what was intended.
  const clash = new Set(over.flatMap(o => [o.outer, o.inner]));
  // ⚠️ RECORD IT BEFORE UN-STACKING. The note asked `series.some(sr => sr.stacked)` AFTER this line had
  // already cleared the flag, so it could never fire — the chart quietly drew unstacked and said
  // nothing. **A correction nobody is told about is the failure the note exists to prevent.**
  const unstacked = series.filter(sr => sr.stacked && clash.has(sr.groupId ?? sr.group ?? sr.id))
                          .map(sr => sr.label);
  series = series.map(sr => (sr.stacked && clash.has(sr.group ?? sr.id) ? { ...sr, stacked: false } : sr));
  return {
    kind,
    x: months(doc), ticks: axisTicks(doc),
    series, format: "money",
    custom: true,
    // ⚠️ THE REFUSAL IS PER SERIES NOW, not per chart — a stacked series whose measure overlaps another
    // is un-stacked and said so, rather than the whole chart falling back to lines.
    // NAMES WHAT IT UN-STACKED, rather than saying "some of these" and leaving the reader to work out
    // which — the same reason the flat-zero guard names its measures instead of counting them.
    note: unstacked.length
      ? `${[...new Set(unstacked)].join(" and ")} overlap other measures here, so they are drawn `
        + "unstacked — stacking them would not add up."
      : null,
  };
}
