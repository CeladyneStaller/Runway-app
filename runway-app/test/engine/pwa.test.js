// The service worker. One rule, and it is the only thing worth testing here by static inspection:
// CACHE THE APP, NEVER THE DATA. A stale runway number is worse than an error — an error is obviously
// wrong, and a cached figure from last week looks exactly like this week's.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const sw = readFileSync("public/sw.js", "utf8");
const manifest = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));

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
    expect(manifest.theme_color).toBe("#10876B");
    expect(manifest.background_color).toBe("#E9EEEC");
  });
});
