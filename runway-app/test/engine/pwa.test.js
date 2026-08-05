// The service worker. One rule, and it is the only thing worth testing here by static inspection:
// CACHE THE APP, NEVER THE DATA. A stale runway number is worse than an error — an error is obviously
// wrong, and a cached figure from last week looks exactly like this week's.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const sw = readFileSync("public/sw.js", "utf8");
// READ THE MANIFEST THE PAGE ACTUALLY REFERENCES, rather than a path typed in here.
//
// This test spent its whole life validating `public/manifest.webmanifest` while `index.html` pointed at
// `/site.webmanifest`. Two manifests existed with different colours and different icon lists, and the
// tested one was the one no browser ever loaded — so the icons could have been wrong in every install
// and this file would still have been green.
//
// Deriving the path from `index.html` makes that class of drift impossible.
const html = readFileSync("index.html", "utf8");
const href = /<link[^>]+rel="manifest"[^>]+href="([^"]+)"/.exec(html)?.[1];
if (!href) throw new Error("index.html declares no manifest");
const manifest = JSON.parse(readFileSync("public" + href, "utf8"));

describe("what the worker refuses to cache", () => {
  it("bails out on any cross-origin request", () => {
    // Supabase, Stripe and Sentry all go straight to the network. Serving a cached document, auth
    // response or subscription state would be a correctness bug with financial consequences.
    expect(sw).toMatch(/url\.origin !== self\.location\.origin\)\s*return/);
  });

  it("caches only content-hashed assets, where the filename changes with the content", () => {
    expect(sw).toMatch(/startsWith\("\/assets\/"\)/);
  });

  it("serves navigations network-first, so a deploy is picked up immediately", () => {
    expect(sw).toMatch(/req\.mode === "navigate"/);
    expect(sw).toMatch(/fetch\(req\)\.catch\(/);
  });

  it("ignores non-GET entirely — a cached POST would be a lie", () => {
    expect(sw).toMatch(/req\.method !== "GET"\)\s*return/);
  });

  it("drops old caches on activate, so a deploy cannot leave half an old app running", () => {
    expect(sw).toMatch(/caches\.delete/);
  });
});

describe("installability", () => {
  it("has what a browser needs to offer an install", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it("includes a maskable icon, or Android crops the logo into a circle badly", () => {
    expect(manifest.icons.some(i => i.purpose === "maskable")).toBe(true);
  });

  it("uses the app's own colours rather than a browser default", () => {
    // Pine and bone, matching the icons and the mark. The old values here (#10876B teal on #E9EEEC)
    // were from a palette the product had already left — and because this test was reading the wrong
    // manifest, nothing ever noticed.
    expect(manifest.theme_color).toBe("#16352C");
    expect(manifest.background_color).toBe("#F3EFE6");
  });

  it("AGREES WITH THE PAGE'S OWN theme-color meta", () => {
    // Two places state the chrome colour and a browser reads both. When they disagree the address bar
    // and the splash screen are different colours, which looks like a rendering fault rather than a
    // configuration one.
    const meta = /<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/.exec(html)?.[1];
    expect(meta?.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });

  it("ships every icon the manifest promises", () => {
    // A manifest entry pointing at a file that is not there fails silently: the launcher falls back to
    // a screenshot of the page, which is how an app ends up with a white square on somebody's home
    // screen and nobody finds out.
    for (const i of manifest.icons) {
      expect(existsSync("public" + i.src), i.src).toBe(true);
    }
  });
});
