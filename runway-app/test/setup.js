// THIS FILE RUNS IN BOTH ENVIRONMENTS. The engine project runs in `node`, where there is no document,
// no HTMLAnchorElement and no stylesheet to load — so everything DOM-shaped below is guarded rather
// than split into a second setup file. One setup file that knows which world it is in beats two that
// drift apart, and the guards double as documentation of what is actually browser-specific.
if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  await import("../src/styles.css");   // main.jsx does this in the browser; do it here so tests match
}
// jsdom is not a browser. Two things it lacks that this app uses, stubbed once rather than
// swallowed per-test — a suite that prints stack traces on a green run is a suite you stop reading.
import "fake-indexeddb/auto";      // real IndexedDB semantics, in memory. Lets us actually TEST storage.

// Downloads: jsdom has no createObjectURL and treats an anchor click as navigation, which it then
// reports as "Not implemented: navigation" — asynchronously, so it lands in an unrelated file's output.
if (typeof HTMLAnchorElement !== "undefined") {
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => "blob:test";
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...a) {
    if (this.hasAttribute("download")) return;   // a download is not a navigation; let it no-op
    return click.apply(this, a);
  };
}
