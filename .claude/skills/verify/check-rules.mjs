// Static checks for the project rules in CLAUDE.md and .claude/rules/. Node built-ins only.
// Run from the project root: node .claude/skills/verify/check-rules.mjs   (exit code 1 on any failure)
import { readFileSync, readdirSync } from 'node:fs';

let failures = 0;
function report(ok, label, details = []) {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ': ' + details.join(', ')}`);
}

const jsFiles = readdirSync('js').filter((f) => f.endsWith('.js'));
const source = Object.fromEntries(jsFiles.map((f) => [f, readFileSync(`js/${f}`, 'utf8')]));
const filesWhere = (test, allowed) => jsFiles.filter((f) => !allowed.includes(f) && test(source[f]));

report(filesWhere((s) => /localStorage/.test(s), ['storage.js']).length === 0,
  'localStorage only in storage.js', filesWhere((s) => /localStorage/.test(s), ['storage.js']));

const domUse = (s) => /\bdocument\.|querySelector|\bwindow\.(alert|confirm)/.test(s);
report(filesWhere(domUse, ['app.js', 'blocked.js', 'theme.js']).length === 0,
  'DOM only in app.js / blocked.js (+ theme.js)', filesWhere(domUse, ['app.js', 'blocked.js', 'theme.js']));

const themeDom = [...new Set(source['theme.js'].match(/document\.[\w.]+/g) || [])];
report(themeDom.every((use) => use === 'document.documentElement.dataset.theme'),
  'theme.js touches only <html data-theme>', themeDom);

const chromeUse = (s) => /\bchrome\./.test(s);
report(filesWhere(chromeUse, ['blocker.js', 'background.js']).length === 0,
  'chrome.* only in blocker.js / background.js', filesWhere(chromeUse, ['blocker.js', 'background.js']));

// Colors: literals only inside the light :root block and the single dark block
const cssLines = readFileSync('css/style.css', 'utf8').split(/\r?\n/);
let inTokens = false;
const colorLines = [];
cssLines.forEach((line, i) => {
  if (/^:root(\[data-theme="dark"\])?\s*\{/.test(line)) inTokens = true;
  else if (inTokens && /^\}/.test(line)) { inTokens = false; return; }
  const code = line.replace(/\/\*.*?\*\//g, '');
  if (!inTokens && /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(code)) colorLines.push(`style.css:${i + 1}`);
});
report(colorLines.length === 0, 'no hard-coded colors outside the token blocks', colorLines);
report(!cssLines.some((l) => /prefers-color-scheme/.test(l)), 'no @media (prefers-color-scheme) (one dark block only)');
report(cssLines.filter((l) => /^:root\[data-theme="dark"\]/.test(l)).length === 1, 'exactly one :root[data-theme="dark"] block');

for (const page of readdirSync('.').filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(page, 'utf8');
  const head = html.split('</head>')[0];
  report(/<script src="js\/storage\.js"><\/script>\s*<script src="js\/theme\.js"><\/script>/.test(head),
    `${page}: storage.js + theme.js un-deferred in <head>`);
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>|\son[a-z]+\s*=/gi)].map((m) => m[0].trim());
  report(inline.length === 0, `${page}: no inline scripts / on* attributes`, inline);
}

console.log(failures ? `\n${failures} rule check(s) FAILED` : '\nall rule checks passed');
process.exit(failures ? 1 : 0);
