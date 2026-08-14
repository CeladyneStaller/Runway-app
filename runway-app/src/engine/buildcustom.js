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

  // ⚠️ A THIRD UNIT IS REFUSED RATHER THAN GIVEN A THIRD AXIS NOBODY CAN READ. Two is already a
  // compromise; three is a picture with no scale.
  if (units.length > 2) {
    return { kind: "lines", x: months(doc), ticks: axisTicks(doc), series: [], format: "money",
             note: "Too many different units on one chart — plot at most two." };
  }

  // ⚠️ `across` WAS STORED AND NEVER READ — zero references in this file. The control offered Month or
  // any dimension, wrote the field, and the engine built a monthly chart regardless. **A control that
  // records a choice and changes nothing is the same failure as the company default**, one screen over.
  //
  // A CATEGORY AXIS IS A DIFFERENT SHAPE, not a variation. There is no time: each measure contributes
  // ONE number per category — its total across the window — so the series are indexed by category and
  // the ticks are names rather than months.
  const acrossDim = cfg?.across && cfg.across !== "month" ? dimensionById(cfg.across) : null;
  // ⚠️ THE ENGINE REFUSES THE ILLEGAL PAIR TOO, not just the control. A chart SAVED before the reset
  // existed can still carry `orient: "y"` with a time axis, and months down the side is not a shape
  // anything draws — so it would blank on load with no way for the person to see why.
  //
  // The builder clears it on change; this makes a stored one harmless. **A UI guard protects the next
  // action; an engine guard protects the data already written.**
  const orient = acrossDim ? (cfg?.orient || "x") : "x";
  if (acrossDim) {
    const cats = new Map();          // key -> label, in first-seen order
    const perMeasure = [];
    for (const spec of cfg.measures || []) {
      const m = measureById(spec.id);
      if (!m) continue;
      const split = splitBy(acrossDim, linesFor(spec.id, parts, doc), n, doc);
      const totals = new Map();
      for (const sp of split) {
        if (!cats.has(sp.id)) cats.set(sp.id, sp.label);
        totals.set(sp.id, sp.values.slice(0, win).reduce((a, b) => a + b, 0) * (spec.negate ? -1 : 1));
      }
      perMeasure.push({ spec, m, totals });
    }
    const keys = [...cats.keys()];
    if (!keys.length) {
      return { kind: "lines", x: [], ticks: [], series: [], format: "money",
               note: `Nothing is tagged with a ${acrossDim.label.toLowerCase()} yet.` };
    }

    // ⚠️ HORIZONTAL BARS TAKE `rows`, NOT `series` — a different contract entirely, which is why the Y
    // toggle drew a blank chart: it asked for `hbars` and handed it a monthly series list.
    if (orient === "y") {
      // ⚠️ SEVERAL MEASURES WERE ALWAYS POSSIBLE — a row carries `segments`, a LIST. I read that field,
      // used one element, and wrote a note explaining why more was impossible. **The limitation was
      // mine, not the renderer's**, and it was stated confidently enough to look researched.
      //
      // One segment per measure, accumulating from zero: positives grow right, negatives grow left, so
      // a row reads as that category's composition either side of the line.
      const colors = colorsFor(perMeasure.map(({ spec }) => ({ id: spec.id })), null);
      return {
        kind: "hbars", format: "money", magnitude: true,
        rows: keys.map(k => ({
          label: cats.get(k),
          segments: perMeasure.map(({ spec, m, totals }, idx) => ({
            id: spec.id, label: m.label, value: totals.get(k) ?? 0,
            // A COLOUR PER MEASURE, so the segments of one row are distinguishable — unless sign
            // colouring is on, which takes the channel by the same rule as everywhere else.
            color: spec.signColor && !spec.by ? null : colors[idx],
            tone: (totals.get(k) ?? 0) < 0 ? "danger" : "signal",
            signColor: !!spec.signColor && !spec.by,
          })),
        })).sort((a, b) => {
          const mag = (r) => r.segments.reduce((x, sg) => x + Math.abs(sg.value), 0);
          return mag(b) - mag(a);
        }),
      };
    }

    const colors = colorsFor(keys.map(k => ({ id: k })),
                             acrossDim.typeOf ? (k) => acrossDim.typeOf(k, doc) : null);
    return finish(cfg, doc, perMeasure.map(({ spec, m }, idx) => ({
      id: spec.id, label: m.label,
      values: keys.map(k => perMeasure[idx].totals.get(k) ?? 0),
      tone: TONES[idx % TONES.length],
      // ⚠️ SIGN COLOURING WAS DROPPED ON THIS PATH. The monthly branch passes it and the category
      // branch did not — so the toggle worked against months and silently did nothing against
      // categories. Same exclusion: a breakdown wins, because colour cannot carry both.
      signColor: !!spec.signColor && !spec.by,
      shape: spec.shape || "bars", stacked: !!spec.stacked, axis: spec.axis || "left",
      group: spec.id,
    })), ids, { x: keys.map(k => cats.get(k)),
                // `categorical: true` is how the axis knows these are names rather than month offsets — the
                // renderer cannot tell from the shape, and inferring it was fragile.
                ticks: keys.map((k, i) => ({ i, label: cats.get(k), categorical: true })),
                colors });
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

    // ⚠️ SIGN COLOURING AND A BREAKDOWN CANNOT COEXIST ON ONE DATASET. Colour by VALUE and colour by
    // IDENTITY want the same channel; four projects all sign-coloured are four red-and-green series
    // nobody can tell apart. The breakdown wins — it is the more specific request — and the note says
    // which was dropped.
    const signColor = !!spec.signColor && !spec.by;
    // NEGATION IS A VIEW OF THE MEASURE, NOT A DIFFERENT MEASURE. Money out plotted downward is the
    // same number, so `contains` and the overlap guard keep working on the un-negated identity.
    const flip = spec.negate ? (arr) => arr.map(v => -(Number(v) || 0)) : (arr) => arr;

    if (dim) {
      const split = splitBy(dim, linesFor(spec.id, parts, doc), n, doc);
      const colors = colorsFor(split, dim.typeOf ? (k) => dim.typeOf(k, doc) : null);
      split.forEach((sp, k) => out.push({
        id: `${spec.id}:${sp.id}`, label: `${sp.label}`, values: flip(clip(sp.values)),
        color: colors[k], tone: sp.unassigned ? "muted" : null,
        shape: spec.shape || "lines", stacked: !!spec.stacked, axis: spec.axis || "left",
        // THE GROUP IT CAME FROM, so a stack of one measure's parts does not merge with another's.
        group: spec.id,
      }));
    } else {
      out.push({
        id: spec.id, label: m.label, values: flip(clip(m.get(rows, parts, doc))), signColor,
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

function finish(cfg, doc, series, ids, axis = null) {
  // A CATEGORY CHART SUPPLIES ITS OWN x AND ticks — names rather than months.
  const ok = allowedTypes(ids);
  // ⚠️ THE CHART KIND COMES FROM SHAPE + STACKED + ORIENTATION, not from a single type name. `Stack`
  // already renders FILLED PATHS rather than rects, so a stacked line was drawable all along — only
  // the way to ask for it was missing.
  // ⚠️ NO LONGER ONE KIND FOR THE CHART. Shape and stacking are carried on each series and resolved by
  // `Composite`; only ORIENTATION is chart-level, because it decides which axis the categories run
  // along and cannot differ per dataset.
  // SAME RULE AS `buildCustom`, recomputed here because this is a separate function: a Y orientation
  // is only meaningful on a category axis, and a stored one on a time axis is ignored rather than
  // drawn as a shape that does not exist.
  const acrossIsCategory = cfg?.across && cfg.across !== "month";
  const kindFromControls = acrossIsCategory && cfg?.orient === "y" ? "hbars" : "composite";
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
  const droppedSign = (cfg?.measures || []).filter(x => x.signColor && x.by).map(x => measureById(x.id)?.label);
  // ⚠️ OVERLAP ONLY MATTERS WITHIN A STACK, NOT ACROSS THE CHART.
  //
  // The first rule un-stacked every series whose measure appeared in ANY overlap — so selecting money
  // in, money out and net un-stacked all three, because net contains the other two. **That forbade the
  // most useful chart on the tab**: in and out stacked against each other, with net as a line over
  // them. A line is not part of the sum; it cannot double-count a stack it does not join.
  //
  // A stack is wrong only when one of ITS OWN members contains another of its own members.
  // SAME RULE AS THE CHECKBOX, from `charttype.js` — see the note there on why it has one home.
  const stackedIds = new Set(series.filter(sr => sr.stacked).map(sr => sr.group ?? sr.id));
  const clash = new Set(
    over.filter(o => stackedIds.has(o.outer) && stackedIds.has(o.inner))
        .flatMap(o => [o.outer, o.inner]));

  // RECORD BEFORE UN-STACKING — the note used to ask `series.some(sr => sr.stacked)` after the flag was
  // cleared, so it could never fire.
  const unstacked = series.filter(sr => sr.stacked && clash.has(sr.group ?? sr.id)).map(sr => sr.label);
  series = series.map(sr => (sr.stacked && clash.has(sr.group ?? sr.id) ? { ...sr, stacked: false } : sr));
  return {
    kind,
    x: axis?.x || months(doc), ticks: axis?.ticks || axisTicks(doc),
    series, format: "money",
    custom: true,
    // ⚠️ THE REFUSAL IS PER SERIES NOW, not per chart — a stacked series whose measure overlaps another
    // is un-stacked and said so, rather than the whole chart falling back to lines.
    // NAMES WHAT IT UN-STACKED, rather than saying "some of these" and leaving the reader to work out
    // which — the same reason the flat-zero guard names its measures instead of counting them.
    note: droppedSign.length
      ? `${droppedSign.join(" and ")} is broken down, so its colours show which series is which rather `
        + "than the sign — one colour channel, two jobs."
      : unstacked.length
      ? `${[...new Set(unstacked)].join(" and ")} overlap other measures here, so they are drawn `
        + "unstacked — stacking them would not add up."
      : null,
  };
}
