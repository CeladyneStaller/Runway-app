// The .addbtn / .rvbtn solid-button fix, guarded against regression. jsdom doesn't apply the stylesheet
// cascade (every button computes to the UA default), so this asserts the CSS SOURCE keeps the shape
// that makes solid buttons work: the reset scoped to :not([class]), and solid classes carrying a real
// background. If someone re-broadens the reset to `.rw button{background:none}`, this fails.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("solid buttons stay solid", () => {
  it("the reset targets unclassed buttons only", () => {
    // the bug was `.rw button{...background:none}` (0,1,1) beating `.addbtn` (0,1,0).
    expect(css).toMatch(/\.rw button:not\(\[class\]\)/);
    // and there is no un-scoped `.rw button { background: none }` anymore
    const unscoped = css.match(/\.rw button\s*\{[^}]*\}/g) || [];
    unscoped.forEach(rule => expect(rule).not.toMatch(/background:\s*(none|transparent)/));
  });
  it(".addbtn is solid (ink background, white text) with a ghost variant", () => {
    expect(css).toMatch(/\.addbtn\{[^}]*background:var\(--ink\)/);
    expect(css).toMatch(/\.addbtn\{[^}]*color:#fff/);
    expect(css).toMatch(/\.addbtn\.ghost\{[^}]*background:var\(--card\)/);
  });
  it(".rvbtn has a real base and its go/no intents", () => {
    expect(css).toMatch(/\.rvbtn\{[^}]*background:var\(--card\)/);
    expect(css).toMatch(/\.rvbtn\.go\{[^}]*background:var\(--signal\)/);
    expect(css).toMatch(/\.rvbtn\.no\{[^}]*background:var\(--danger\)/);
  });
});

describe("the sidebar is light with a green selected tab", () => {
  it("the rail is a light panel, not the old dark ink", () => {
    expect(css).toMatch(/\.rail\{[^}]*background:var\(--card\)/);
    expect(css).not.toMatch(/\.rail\{[^}]*background:var\(--ink\)/);
  });
  it("the selected nav item is green", () => {
    expect(css).toMatch(/\.nav\.on\{[^}]*background:var\(--signal\)/);
    expect(css).toMatch(/\.nav\.on\{[^}]*color:#fff/);
  });
});
