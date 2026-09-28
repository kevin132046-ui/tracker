// Generates app/wafu-palette.css: the dark 和風 palette for every colour in app/globals.css.
// Each rule that sets a colour is repeated under :root[data-wafu] with the colour mapped to a
// theme token by hue and lightness (white panels → --wa-panel, navy ink → --wa-ink, blue → --wa-accent…).
// Layout is never touched, so the classic page stays exactly as it is when data-wafu is absent.
// Run: node scripts/wafu-palette.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
// postcss comes with the Tailwind toolchain already in devDependencies.
const postcss = require(require.resolve('postcss', { paths: [dirname(require.resolve('@tailwindcss/postcss'))] }));

const source = new URL('../app/globals.css', import.meta.url);
const target = new URL('../app/wafu-palette.css', import.meta.url);
const scope = ':root[data-wafu]';

const colorProps = new Set(['color', 'background', 'background-color', 'background-image', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline', 'outline-color', 'box-shadow', 'fill', 'stroke', 'accent-color', 'caret-color', 'text-decoration-color', 'column-rule-color', 'scrollbar-color', 'text-shadow', 'stop-color']);
const named = { white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
const colorPattern = /#[0-9a-f]{8}\b|#[0-9a-f]{6}\b|#[0-9a-f]{3,4}\b|rgba?\([^)]*\)|\bwhite\b|\bblack\b/gi;

function parse(text) {
  const t = text.toLowerCase();
  if (named[t]) return named[t];
  if (t.startsWith('#')) {
    const h = t.slice(1);
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    const n = (i) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const parts = t.replace(/rgba?\(|\)/g, '').split(/[\s,/]+/).filter(Boolean).map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

function hsl([r, g, b]) {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

/** Hue family of a saturated colour. */
function family(h) {
  if (h < 20 || h >= 330) return 'down';
  if (h < 65) return 'gold';
  if (h < 175) return 'up';
  if (h < 250) return 'accent';
  return 'accent-2';
}

const withAlpha = (token, a) => a >= 0.999 ? `var(--wa-${token})` : `rgb(var(--wa-${token}-rgb) / ${+a.toFixed(3)})`;

/** The theme colour for one colour, by the role it plays in this declaration. onStrong: the rule paints a saturated background, so white text on it becomes the dark "on accent" ink. */
function mapColor(raw, role, onStrong = false) {
  const [r, g, b, a] = parse(raw);
  if (a === 0) return raw;
  const [h, s, l] = hsl([r, g, b]);
  const saturated = s > 0.35 && l > 0.12 && l < 0.92;
  if (role === 'shadow') {
    if (l < 0.35) return `rgb(0 0 0 / ${+Math.min(0.7, a * 2.2).toFixed(3)})`;
    if (saturated || (s > 0.3 && l < 0.97)) return withAlpha(family(h), Math.min(0.35, a));
    return `rgb(0 0 0 / ${+Math.min(0.4, a).toFixed(3)})`;
  }
  if (role === 'background') {
    if (l >= 0.92) {
      // Near-white panels and tinted boxes.
      if (s < 0.3 || l >= 0.985) return a < 1 ? `rgb(var(--wa-raise-rgb) / ${+Math.min(0.08, a * 0.08).toFixed(3)})` : r + g + b === 765 ? 'var(--wa-panel)' : 'var(--wa-raise)';
      return `var(--wa-${family(h)}-soft)`;
    }
    if (saturated) return withAlpha(family(h), a);
    if (l < 0.3) return a < 1 ? `rgb(0 0 0 / ${+Math.min(0.7, a * 1.6).toFixed(3)})` : 'var(--wa-panel-solid)';
    return withAlpha('line-2', Math.min(1, a));
  }
  if (role === 'border') {
    if (saturated && s > 0.5) return withAlpha(family(h), Math.min(1, a));
    if (l >= 0.9 || (a < 1 && l > 0.5)) return 'var(--wa-line)';
    return 'var(--wa-line-2)';
  }
  // Text, icons and strokes.
  if (l >= 0.95 && s < 0.3) return a < 1 ? `rgb(var(--wa-ink-rgb) / ${+a.toFixed(3)})` : onStrong ? 'var(--wa-on-accent)' : 'var(--wa-ink)';
  if (saturated) return withAlpha(family(h), a);
  if (l < 0.3) return withAlpha('ink', a);
  if (l < 0.45) return withAlpha('ink-2', a);
  return withAlpha('muted', a);
}

function roleOf(prop, value) {
  if (prop === 'box-shadow' || prop === 'text-shadow') return 'shadow';
  if (prop.startsWith('background')) return 'background';
  if (prop.startsWith('border') || prop.startsWith('outline') || prop === 'column-rule-color') return 'border';
  if (prop === 'fill' && !/url\(/.test(value)) return 'text';
  return 'text';
}

const map = (prop, value, onStrong) => value.replace(colorPattern, (raw) => mapColor(raw, roleOf(prop, value), onStrong));

/** Whether a rule paints a saturated background (a blue or green button, a red badge). */
function paintsStrong(rule) {
  let strong = false;
  rule.each((decl) => {
    if (decl.type !== 'decl' || !decl.prop.startsWith('background')) return;
    if (/var\(--(blue|green|red|purple|cyan)\)/.test(decl.value)) strong = true;
    for (const raw of decl.value.match(colorPattern) ?? []) {
      const [r, g, b, a] = parse(raw);
      const [, s, l] = hsl([r, g, b]);
      if (a >= 0.8 && s > 0.35 && l > 0.3 && l < 0.75) strong = true;
    }
  });
  return strong;
}
// Custom properties from :root map by name to the theme tokens.
const rootVars = { '--navy': 'var(--wa-bg)', '--navy-2': 'var(--wa-panel-solid)', '--ink': 'var(--wa-ink)', '--muted': 'var(--wa-muted)', '--blue': 'var(--wa-accent)', '--blue-soft': 'var(--wa-accent-soft)', '--cyan': 'var(--wa-accent)', '--green': 'var(--wa-up)', '--red': 'var(--wa-down)', '--purple': 'var(--wa-accent-2)', '--line': 'var(--wa-line)', '--canvas': 'var(--wa-bg)', '--surface': 'var(--wa-panel)' };

function scoped(selector) {
  return selector.split(',').map((part) => {
    const s = part.trim();
    if (s === ':root' || s === 'html') return scope;
    if (s === 'body') return `${scope} body`;
    return `${scope} ${s}`;
  }).join(', ');
}

const input = postcss.parse(readFileSync(source, 'utf8'));
const output = postcss.root();
let count = 0;

function visit(container, into) {
  container.each((node) => {
    if (node.type === 'atrule') {
      if (node.name === 'keyframes' || node.name === 'font-face' || node.name === 'import') return;
      const copy = postcss.atRule({ name: node.name, params: node.params });
      visit(node, copy);
      if (copy.nodes?.length) into.append(copy);
      return;
    }
    if (node.type !== 'rule' || node.selector.trim() === '*') return;
    const decls = [];
    const onStrong = paintsStrong(node);
    node.each((decl) => {
      if (decl.type !== 'decl') return;
      if (node.selector.trim() === ':root' && rootVars[decl.prop]) { decls.push(postcss.decl({ prop: decl.prop, value: rootVars[decl.prop] })); return; }
      if (!colorProps.has(decl.prop) && !decl.prop.startsWith('--')) return;
      if (!colorPattern.test(decl.value)) { colorPattern.lastIndex = 0; return; }
      colorPattern.lastIndex = 0;
      const value = map(decl.prop, decl.value, onStrong);
      if (value !== decl.value) decls.push(postcss.decl({ prop: decl.prop, value, important: decl.important }));
    });
    if (!decls.length) return;
    const rule = postcss.rule({ selector: scoped(node.selector) });
    decls.forEach((decl) => rule.append(decl));
    into.append(rule);
    count += decls.length;
  });
}

visit(input, output);
const header = '/* Generated by scripts/wafu-palette.mjs from app/globals.css — do not edit; run the script again after changing globals.css. */\n';
writeFileSync(target, header + output.toString().replace(/\n{3,}/g, '\n\n') + '\n');
console.log(`wafu-palette.css: ${count} colour declarations`);
