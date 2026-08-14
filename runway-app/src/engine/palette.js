// ── Colour for a breakdown ───────────────────────────────────────────────────────────────────────
//
// ⚠️ THE PROBLEM: COLOUR WAS CARRYING TWO JOBS. Which KIND a series is, and which ONE it is. Broken
// down by project, four grants drew as four near-identical greens — the type survived and the identity
// did not, which is backwards, because identity is what a breakdown exists for.
//
// HUE BY TYPE, LIGHTNESS BY MEMBER. Grants stay green; two grants are a dark and a light green. The
// ramp then only has to separate the members of ONE type rather than everything at once.

const HUES = {
  grant: "#10876B",         // signal
  fulfillment: "#B4674A",   // clay
  internal: "#1C4E63",      // thrust
  subcontract: "#6B4E9E",   // gate
  other: "#7A5C3E",         // brown
};

/** One hue each, for dimensions whose values have no type worth preserving. */
export const SOLO = ["#10876B", "#1C4E63", "#B4674A", "#6B4E9E", "#7A5C3E", "#C9821B", "#4FB79A"];

/** ⚠️ SEMANTIC AND FIXED. A confidence tier means the same thing on every chart in the product, so its
 *  colour is not allocated from a ramp — it is looked up. */
export const SEMANTIC = {
  committed: "#0B5F4B", expected: "#4FB79A", speculative: "#C9821B",
};

/** ⚠️ AN ABSENCE OF ASSIGNMENT IS NOT A MEMBER. Grey on every dimension, always — colouring it from
 *  the palette implies it is a peer of the things it is missing from. */
export const UNASSIGNED = "#8698A0";

const hex2 = (h) => {
  const s = String(h).replace("#", "");
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
};
const toHex = (r, g, b) => "#" + [r, g, b]
  .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

/** Lighten or darken toward white/black by a fraction. */
export function shade(hex, amount) {
  const [r, g, b] = hex2(hex);
  if (amount >= 0) return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
  const k = 1 + amount;
  return toHex(r * k, g * k, b * k);
}

/** The lightness steps for n members of one type.
 *
 *  ⚠️ IT SPANS A LIMITED RANGE ON PURPOSE. Going all the way to white and black would separate ten
 *  members and produce two that read as "empty" and "black" rather than as the colour they belong to.
 *  Past about four of one type the steps get too close — which is where the twelve-series cap already
 *  says the chart is over-broken-down.
 */
export function ramp(base, n) {
  if (n <= 1) return [base];
  const lo = -0.28, hi = 0.42;
  return Array.from({ length: n }, (_, i) => shade(base, lo + ((hi - lo) * i) / (n - 1)));
}

/**
 * Colours for a set of split series, in the order they were given.
 *
 * @param series  [{ id, label, unassigned }]
 * @param typeOf  (id) => typeKey | null   — from the dimension; null means "no type to preserve"
 */
export function colorsFor(series = [], typeOf = null) {
  const out = new Array(series.length);

  // Semantic first: if every value is a known tier, the fixed map wins outright.
  if (series.every(s => s.unassigned || SEMANTIC[s.id])) {
    series.forEach((s, i) => { out[i] = s.unassigned ? UNASSIGNED : SEMANTIC[s.id]; });
    return out;
  }

  if (!typeOf) {
    let k = 0;
    series.forEach((s, i) => { out[i] = s.unassigned ? UNASSIGNED : SOLO[k++ % SOLO.length]; });
    return out;
  }

  // Group by type, then ramp within each — so the ramp divides only the members of one type.
  const groups = new Map();
  series.forEach((s, i) => {
    if (s.unassigned) { out[i] = UNASSIGNED; return; }
    const t = typeOf(s.id) || "other";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(i);
  });
  let spare = 0;
  for (const [t, idxs] of groups) {
    const base = HUES[t] || SOLO[spare++ % SOLO.length];
    const steps = ramp(base, idxs.length);
    idxs.forEach((idx, j) => { out[idx] = steps[j]; });
  }
  return out;
}

export { HUES };
