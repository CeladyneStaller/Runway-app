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
  // ⚠️ THREADS, NOT FORKS — A WORKER THAT NEVER STARTS FAILS DIFFERENTLY FROM A TEST THAT FAILS.
  //
  // A Windows run reported seven `[vitest-pool]: Failed to start forks worker` errors alongside a
  // completely unrelated assertion failure. Nothing was wrong with those seven files; the pool timed
  // out waiting for the forked PROCESS to answer. Forks are a full `child_process` spawn each, and on
  // Windows — with a space in the repo path and a virus scanner reading every file the process opens —
  // spawning a dozen of them at once is where that time goes. The run showed `setup 159s` and
  // `environment 198s` against a `duration` of 174s: cumulative worker startup EXCEEDING the wall clock
  // of the whole suite.
  //
  // Threads share one process and start in milliseconds. Nothing in this suite needs process
  // isolation: no test mutates `process.env` or `process.cwd`, and the engine is pure functions.
  //
  // ⚠️ AND UNSTARTED WORKERS ARE REPORTED AS "unhandled errors" RATHER THAN FAILURES, so the suite says
  // "1 failed" while seven files did not run at all. Treat any pool error as "the suite did not
  // finish", not as a passing run with noise attached.
  pool: "threads",
  // The view tests mount the full app in jsdom and do a lot of DOM work; the default 5s timeout has
  // no margin on a loaded machine (a Windows run timed out at ~5.1s on a test that takes ~1.4s here).
  // 15s is realistic headroom, not a mask for a slow test — the engine tests still run in ms.
  testTimeout: 15000,
};

// THE RELEASE TAG, resolved at build time.
//
// It goes on every error event so Sentry can say "this started at commit a3f9c2e" rather than just
// "this is broken". Resolved HERE rather than in the Vercel dashboard because VERCEL DOES NOT EXPAND
// ENVIRONMENT VARIABLES: setting VITE_RELEASE to "$VERCEL_GIT_COMMIT_SHA" in the UI stores that
// literal string, and you get a release called "$VERCEL_GIT_COMMIT_SHA" on every deploy — which looks
// like it worked right up until you need to tell two builds apart.
//
// Vite only exposes VITE_-prefixed variables to browser code, so the platform's own variable cannot
// be read directly. This bridges the two, and falls back sensibly everywhere else.
const release =
  process.env.VITE_RELEASE                      // explicit override wins
  || process.env.VERCEL_GIT_COMMIT_SHA          // Vercel
  || process.env.GITHUB_SHA                     // GitHub Actions
  || process.env.CF_PAGES_COMMIT_SHA            // Cloudflare Pages
  || "dev";

export default defineConfig({
  plugins: [react()],
  // Injected as a literal so it survives into the bundle without a VITE_ variable having to exist.
  define: { "import.meta.env.VITE_RELEASE": JSON.stringify(release) },
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
