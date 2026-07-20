import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.{js,jsx}"],
    // The view tests mount the full app in jsdom and do a lot of DOM work; the default 5s timeout has
    // no margin on a loaded machine (a Windows run timed out at ~5.1s on a test that takes ~1.4s here).
    // 15s is realistic headroom, not a mask for a slow test — the engine tests still run in ms.
    testTimeout: 15000,
  },
});
