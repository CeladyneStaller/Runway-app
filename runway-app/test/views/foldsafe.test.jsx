// The collapse button must not overlap the delete button in an expanded card — one is destructive.
// jsdom has no layout, so we assert the CSS SOURCE keeps collapse and delete on opposite sides.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("expanded-card collapse button doesn't sit on the delete button", () => {
  it("the expanded wrapper moves collapse to the left", () => {
    expect(css).toMatch(/\.projwrap>\.projfold\{[^}]*left:13px/);
    expect(css).toMatch(/\.projwrap>\.projfold\{[^}]*right:auto/);
  });
  it("the header is indented so collapse clears the badge/name", () => {
    expect(css).toMatch(/\.projwrap \.pcard-h\{[^}]*padding-left:46px/);
  });
  it("the collapsed-header chevron is ALSO on the left (expand target away from delete)", () => {
    // clicking to expand must not land the cursor where delete appears post-expansion
    expect(css).toMatch(/\.collapsed \.projfold\{[^}]*left:13px/);
    expect(css).toMatch(/\.collapsed \.projfold\{[^}]*right:auto/);
  });
  it("the collapsed header indents its type tag + title to clear the chevron", () => {
    expect(css).toMatch(/\.csum-head\{[^}]*padding-left:34px/);
  });
});

import { render, fireEvent } from "@testing-library/react";
import { RunwayApp } from "../../src/App";
import { demoDoc } from "../../src/state/document";

describe("both controls are present and are different elements", () => {
  it("an expanded card has a collapse button AND a delete button", () => {
    let d = demoDoc();
    const { container } = render(<RunwayApp doc={d} setDoc={(v) => { d = typeof v === "function" ? v(d) : v; }} />);
    fireEvent.click([...container.querySelectorAll("button")].find(b => /Projects/.test(b.textContent)));
    const expand = [...container.querySelectorAll(".linkbtn")].find(b => /Expand all/.test(b.textContent));
    if (expand) fireEvent.click(expand);
    const wrap = container.querySelector(".projwrap");
    const collapse = wrap.querySelector(".projfold");
    const del = [...wrap.querySelectorAll(".iconbtn")].find(b => /Delete/.test(b.getAttribute("aria-label") || ""));
    expect(collapse).toBeTruthy();
    expect(del).toBeTruthy();
    expect(collapse).not.toBe(del);   // distinct controls, not the same button
  });
});
