import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// TWO TEST PROJECTS, SPLIT BY WHETHER THEY NEED A BROWSER.
//
// The suite used to run everything under `environment: "jsdom"`, which meant all 67 files paid to spin
// up a fake browser and only 37 of them touched the DOM. The engine tests made the waste plain: 288
// tests, 1.17s of actual testing against 13.33s of jsdom startup — eleven times their own runtime, for
// a browser they never use. Splitting takes the engine half from 27s to 9s and the full suite from
// ~308s to ~243s, with the environment cost for engine files falling to about 3ms.
//
// THE UI PROJECT IS A CATCH-ALL, deliberately. Listing `test/{views,state,security}` would be tidier
// and would also mean the first test file added under some new directory got silently SKIPPED rather
// than run. A suite quietly testing less than you think is a far worse failure than a few files paying
// for a jsdom they don't need. So node is the narrow opt-in list and jsdom is everything else: a new
// file runs by default, in the safe environment, and can be moved into `engine` later.
//
// `test/setup.js` is shared by both and guards its own DOM-specific parts on `typeof document`.
const shared = {
  setupFiles: ["./test/setup.js"],
  // The view tests mount the full app in jsdom and do a lot of DOM work; the default 5s timeout has
  // no margin on a loaded machine (a Windows run timed out at ~5.1s on a test that takes ~1.4s here).
  // 15s is realistic headroom, not a mask for a slow test — the engine tests still run in ms.
  testTimeout: 15000,
};

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        // Pure engine and document logic: no DOM, no rendering.
        plugins: [react()],
        test: {
          ...shared,
          name: "engine",
          environment: "node",
          include: ["test/engine/**/*.test.{js,jsx}"],
        },
      },
      {
        // Everything else: anything that mounts a component, or leans on storage, IndexedDB, or the
        // browser globals the setup file stubs.
        plugins: [react()],
        test: {
          ...shared,
          name: "ui",
          environment: "jsdom",
          include: ["test/**/*.test.{js,jsx}"],
          exclude: ["test/engine/**"],
        },
      },
    ],
  },
});
