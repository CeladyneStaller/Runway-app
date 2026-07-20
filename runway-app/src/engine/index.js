// The engine. No React below this line — that's the point.
//
// sf424a.js is DELIBERATELY NOT re-exported here. It is the only engine module with a heavy
// dependency (SheetJS is 432 kB of an 793 kB bundle — 54%), and it is needed only when someone
// imports or exports a workbook. Re-exporting it from the barrel meant that `import { buildProjection }
// from "../engine"` pulled all of SheetJS into the main chunk, so everyone paid for it on every load.
// Import it directly, and dynamically:  const { importWorkbook } = await import("../engine/sf424a");
export * from "./capital.js";
export * from "./coding.js";
export * from "./grant.js";
export * from "./history.js";
export * from "./importer.js";
export * from "./money.js";
export * from "./payroll.js";
export * from "./fringe.js";
export * from "./projection.js";
export * from "./revenue.js";
export * from "./projects.js";
export * from "./projectchart.js";
export * from "./sales.js";
export * from "./summary.js";
export * from "./time.js";
