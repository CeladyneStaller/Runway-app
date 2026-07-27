import "@testing-library/jest-dom/vitest";
import "../src/styles.css";        // main.jsx does this in the browser; do it here so tests match
// jsdom is not a browser. Two things it lacks that this app uses, stubbed once rather than
// swallowed per-test — a suite that prints stack traces on a green run is a suite you stop reading.
import "fake-indexeddb/auto";      // real IndexedDB semantics, in memory. Lets us actually TEST storage.

// Downloads: jsdom has no createObjectURL and treats an anchor click as navigation, which it then
// reports as "Not implemented: navigation" — asynchronously, so it lands in an unrelated file's output.
if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => "blob:test";
if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function (...a) {
  if (this.hasAttribute("download")) return;   // a download is not a navigation; let it no-op
  return click.apply(this, a);
};
