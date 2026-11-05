// Shared helpers for the test scripts. Node built-ins only (no npm packages).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts a headless browser on a FREE DevTools port (the browser picks it, so parallel or leftover
 * runs can never collide) and closes it automatically when this Node process exits for any reason.
 * @param {string} executable   browser path from findBrowser()
 * @param {string} profileDir   from tempProfile()
 * @param {string[]} extraArgs  e.g. ['--load-extension=…']
 * Always `await close()` before exiting: it asks the browser to quit via DevTools (`Browser.close`),
 * which works even when the browser relaunched itself under a new process id (Edge does this),
 * and falls back to killing the spawned process.
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function launchBrowser(executable, profileDir, extraArgs = []) {
  const browserProcess = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--no-first-run',
    ...extraArgs, 'about:blank',
  ], { stdio: 'ignore' });

  const killSpawned = () => { if (browserProcess.exitCode === null) browserProcess.kill(); };
  process.on('exit', killSpawned); // last-resort fallback (cannot await in 'exit')

  // With port 0 the browser writes the port it chose to <profile>/DevToolsActivePort
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  let port = 0;
  for (let waited = 0; waited < 15000 && !port; waited += 100) {
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || 0;
    if (!port) await pause(100);
  }
  if (!port) {
    killSpawned();
    throw new Error(`Browser did not start: ${executable}`);
  }

  const close = async () => {
    await closeViaDevTools(port).catch(() => {});
    killSpawned();
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { close().finally(() => process.exit(130)); });
  return { port, close };
}

/** Sends Browser.close on the browser-level DevTools endpoint and waits (briefly) for it to go away. */
async function closeViaDevTools(port) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  const closed = new Promise((resolve) => socket.addEventListener('close', resolve));
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  await Promise.race([closed, pause(3000)]);
}
