// Extracted from RunwayApp.jsx. Behaviour unchanged — see test/engine/golden.test.js.
import { createContext, useContext } from "react";

// The projection start, supplied by the tree rather than by a module-level `let`. It used to be a
// mutable global reassigned on every render of RunwayApp, which meant two instances on one page would
// fight over it (last render wins) and any pure helper silently depended on whoever rendered last.
// Components destructure it under the same names, so call sites read identically.
export const StartCtx = createContext({ START_Y: 2026, START_M: 6 });

export const useStart = () => useContext(StartCtx);
