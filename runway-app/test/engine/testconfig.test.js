// The test config guards itself.
//
// Splitting the suite into a `node` project and a `jsdom` project bought ~60s, and introduced one new
// way to be wrong that is much worse than being slow: a file matching NEITHER project is not reported
// as failing or skipped — it simply never runs, and the suite goes green while testing less than you
// think. These assertions exist so that can't happen quietly.
//
// It lives under test/engine/ because it needs no DOM and therefore belongs in the fast project — not
// because it is engine logic.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import config from "../../vite.config.js";

const projects = config.test.projects.map(p => p.test);
const engine = projects.find(p => p.name === "engine");
const ui = projects.find(p => p.name === "ui");

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.jsx?$/.test(entry)) out.push(full.replace(/\\/g, "/"));
  }
  return out;
};

describe("the test project split", () => {
  it("has exactly the two projects, in the two environments", () => {
    expect(projects.map(p => p.name).sort()).toEqual(["engine", "ui"]);
    expect(engine.environment).toBe("node");
    expect(ui.environment).toBe("jsdom");
  });

  it("keeps jsdom as a CATCH-ALL, so a new directory can never be silently skipped", () => {
    // THE LOAD-BEARING ASSERTION. Narrowing this to an explicit directory list — test/{views,state,
    // security} — would look tidier and would mean the first file added under some new folder never
    // ran at all. node is the narrow opt-in; jsdom is everything else.
    expect(ui.include).toEqual(["test/**/*.test.{js,jsx}"]);
    expect(ui.exclude).toEqual(["test/engine/**"]);
    expect(engine.include).toEqual(["test/engine/**/*.test.{js,jsx}"]);
  });

  it("claims every test file on disk, exactly once", () => {
    const files = walk("test");
    expect(files.length).toBeGreaterThan(50);
    for (const f of files) {
      const inEngine = f.startsWith("test/engine/");
      // Not both, and never neither — the exclude and the catch-all have to stay complements.
      expect(inEngine || f.startsWith("test/")).toBe(true);
    }
  });

  it("shares one setup file, so the two environments can't drift apart", () => {
    expect(engine.setupFiles).toEqual(ui.setupFiles);
    const setup = readFileSync("test/setup.js", "utf8");
    // It runs in node too, so its DOM-shaped work must be guarded rather than assumed.
    expect(setup).toMatch(/typeof document !== "undefined"/);
    expect(setup).toMatch(/typeof HTMLAnchorElement !== "undefined"/);
  });
});

describe("nothing in the fast project secretly needs a browser", () => {
  it("no engine test renders anything", () => {
    // A rendering test placed under test/engine/ would fail in `node` with a confusing error about a
    // missing document rather than an obvious one about being in the wrong folder. Catch it here.
    const offenders = walk("test/engine").filter(f => {
      // This file is exempt from its own scan: the patterns it searches FOR appear in its own source
      // as regex literals, so it would report itself forever.
      if (f.endsWith("testconfig.test.js")) return false;
      // COMMENTS ARE STRIPPED FIRST. Scanning raw source matched the word "document." at the end of an
      // English sentence and failed a file that touches no DOM at all — a guard that fires on prose
      // teaches people to ignore it, which is worse than not having it.
      const src = readFileSync(f, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return /@testing-library|\bdocument\.|\bwindow\./.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
