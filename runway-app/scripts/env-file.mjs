// Env files for the verification runners.
//
// These scripts are the only things in the repo that need real credentials, and they are run by hand,
// occasionally, months apart. Which means the failure mode is not a bug — it is somebody typing
// `npm run verify:isolation`, getting `Missing SUPABASE_ANON_KEY`, and having to reconstruct six
// variable names from a script header. That happened.
//
// So: load a file, accept BOTH naming conventions, and when something is missing say which names would
// have worked. The environment always wins over the file, because CI sets variables and does not
// deploy dotfiles.

import { existsSync, readFileSync } from "node:fs";

/** Parse a dotenv-ish file. Tolerates CRLF, `export` prefixes, quotes and blank lines. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // The trailing trim matters more than it looks: a value with a stray space or an inherited `\r`
    // reads identically to a correct one everywhere a person can inspect it, and then fails a
    // byte-for-byte comparison somewhere far away. An afternoon went to that with a redirect URI.
    out[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

/** Load the first file that exists, without overwriting anything already in the environment. */
export function loadEnvFiles(paths = [".env.isolation", ".env.local", ".env"]) {
  const loaded = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const vars = parseEnvFile(readFileSync(path, "utf8"));
    for (const [k, v] of Object.entries(vars)) if (!process.env[k]) process.env[k] = v;
    loaded.push(path);
  }
  return loaded;
}

/** First of several accepted names that has a value. */
export const envAny = (...names) => names.map(n => process.env[n]).find(Boolean);

/** Reads a value under any accepted name, or explains precisely what to set.
 *
 *  It lists EVERY accepted name rather than one, because the two conventions in this repo — the vitest
 *  suite grew `SUPABASE_TEST_URL`, the shell runners grew `SUPABASE_URL` — are exactly the kind of
 *  thing that turns a one-hour task into a puzzle. */
export function requireEnv(names, { loadedFrom = [] } = {}) {
  const value = envAny(...names);
  if (value) return value;
  const where = loadedFrom.length ? `loaded ${loadedFrom.join(", ")}` : "no env file found";
  throw new Error(
    `Missing ${names[0]}.\n` +
    `  Accepted names: ${names.join(" or ")}\n` +
    `  Looked in the environment and in .env.isolation / .env.local / .env (${where}).\n` +
    "  See the ISOLATION PROBES section of .env.example for the full set.");
}
