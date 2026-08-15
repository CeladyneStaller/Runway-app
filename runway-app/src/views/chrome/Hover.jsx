import { useState, useRef, useCallback } from "react";
import { valueAt, indexAt, placeTip } from "../../engine/hover";
import { moneyFull } from "../../engine/money";

const fmt = (v, f) => {
  if (!Number.isFinite(v)) return "";
  if (f === "percent") return `${Math.round(v)}%`;
  if (f === "count") return String(Math.round(v));
  return moneyFull(v);
};

/** The values under the pointer.
 *
 *  ⚠️ ONE OVERLAY, ONE HANDLER. Not a listener per series and no hit-testing in the renderers — the
 *  spec holds every value, so this reads the spec and the drawing is left alone.
 */
export function HoverLayer({ spec, box, ctx = {}, format }) {
  const [at, setAt] = useState(null);      // { i, px, py }
  const ref = useRef(null);

  const move = useCallback((e) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const n = spec?.x?.length || spec?.series?.[0]?.values?.length || 0;
    const i = indexAt(px * (box.w / r.width), { left: box.x, width: box.w, n });
    if (i != null) setAt({ i, px: px * (box.w / r.width), py: py * (box.h / r.height) });
  }, [spec, box]);

  // ⚠️ ARROW KEYS MOVE THE MONTH, ESCAPE DISMISSES. The values have to be reachable without a pointer —
  // the accessibility requirements of this customer base are a procurement question, not a preference,
  // and a chart whose numbers are mouse-only fails it.
  const key = useCallback((e) => {
    const n = spec?.x?.length || 0;
    if (!n) return;
    if (e.key === "Escape") { setAt(null); return; }
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    setAt(p => {
      const i = Math.max(0, Math.min(n - 1, (p?.i ?? 0) + d));
      return { i, px: box.x + (box.w * i) / Math.max(1, n - 1), py: box.y + box.h / 2 };
    });
  }, [spec, box]);

  const v = at ? valueAt(spec, at.i, ctx) : null;
  const tip = at ? placeTip(at.px, at.py, { w: box.x + box.w + 40, h: box.y + box.h + 40 }) : null;

  return (
    <>
      {/* THE GUIDE LINE, so the tooltip and the chart agree about which column is being read. */}
      {at && (
        <line x1={box.x + (box.w * at.i) / Math.max(1, (spec?.x?.length || 1) - 1)} y1={box.y}
              x2={box.x + (box.w * at.i) / Math.max(1, (spec?.x?.length || 1) - 1)} y2={box.y + box.h}
              className="hv-guide" />
      )}
      <rect ref={ref} x={box.x} y={box.y} width={box.w} height={box.h}
            fill="transparent" tabIndex={0} className="hv-hit"
            role="application" aria-label="Chart values — use the arrow keys"
            onMouseMove={move} onMouseLeave={() => setAt(null)}
            // TAP SHOWS, TAP ELSEWHERE DISMISSES. There is no hover on a phone, and a chart whose
            // values are mouse-only is a chart half the audience cannot read.
            onPointerDown={move} onKeyDown={key} onBlur={() => setAt(null)} />
      {v && tip && (
        <foreignObject x={tip.x} y={tip.y} width="230" height="180" className="hv-fo">
          <div className="hv-tip" xmlns="http://www.w3.org/1999/xhtml">
            <div className="hv-m">
              <span>{v.label}</span>
              {/* ⚠️ NOT DECORATION. A precise number feels like a fact; this is what keeps a modelled
                  figure from reading as a recorded one. */}
              {v.projected && <span className="chip">projected</span>}
            </div>
            {v.rows.map(r => (
              <div className={"hv-r" + (r.dim ? " dim" : "")} key={r.id}>
                <i style={{ background: r.color || `var(--${r.tone || "signal"})` }} />
                <span>{r.label}</span>
                {r.axis === "right" && <span className="hv-ax">right</span>}
                <b>{fmt(r.value, format || v.format)}</b>
              </div>
            ))}
            {v.total != null && (
              <div className="hv-r hv-t"><span>Total</span><b>{fmt(v.total, format || v.format)}</b></div>
            )}
            {v.band && (
              <div className="hv-f">Range {fmt(v.band.lo, v.format)} to {fmt(v.band.hi, v.format)}</div>
            )}
            {v.categorical && (
              <div className="hv-f">Totalled across the whole window — there is no time axis here.</div>
            )}
          </div>
        </foreignObject>
      )}
    </>
  );
}
