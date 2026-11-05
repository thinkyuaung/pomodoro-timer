// Shared helpers for the test scripts. Node built-ins only (no npm packages).
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root (the folder that contains index.html and manifest.json). */
export const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Screenshots written by the e2e suites (git-ignored). */
export const OUTPUT_DIR = path.join(PROJECT_DIR, 'tests', 'output');
mkdirSync(OUTPUT_DIR, { recursive: true });

const CANDIDATES = {
  edge: [
    process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
  ],
  chrome: [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ],
};

/**
 * Path to an installed browser. `kind` is 'chrome' or 'edge'; falls back to the other one.
 * Override with the CHROME_PATH / EDGE_PATH environment variables.
 */
export function findBrowser(kind) {
  const order = kind === 'edge' ? ['edge'] : ['chrome', 'edge'];
  for (const k of order) {
    const found = CANDIDATES[k].find((p) => p && existsSync(p));
    if (found) return found;
  }
  throw new Error(`No ${kind} browser found. Set ${kind === 'edge' ? 'EDGE_PATH' : 'CHROME_PATH'} to its executable.`);
}

/** A fresh, throw-away browser profile folder in the OS temp directory. */
export function tempProfile(name) {
  return mkdtempSync(path.join(os.tmpdir(), `pomodoro-${name}-`));
}
