// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.

export function money(n, sign = false) {
  const s = n < 0 ? "-" : sign ? "+" : "";
  const a = Math.abs(n);
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 2)}M`;
  if (a >= 1e5) return `${s}$${Math.round(a / 1e3)}k`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(a % 1000 === 0 ? 0 : 1)}k`;
  return `${s}$${Math.round(a)}`;
}

export const moneyFull = (n) => (n < 0 ? "-" : "") + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");

/* ============================================================
   GRANT ENGINE — SF-424A object-class categories & budget periods
   (mirrors the DOE budget-justification workbook; verified in node)
   ============================================================ */
