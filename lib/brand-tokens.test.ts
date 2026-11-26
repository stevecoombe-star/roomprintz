/**
 * Locks the UI-1A.2 brand token foundation in app/globals.css.
 *
 * Hardcoded-colour guard limitations:
 * - Matches only a leading # and exactly six hex digits for Warm White
 *   (#FCF9F4), Charcoal (#1F1F1F), Deep Teal (#395E63), and Sand Gold
 *   (#F6DDA1). Matching is case-insensitive.
 * - A longer hex run, such as a hash digest, is not a match.
 * - Does not match White (#FFFFFF or #fff). White is an approved brand
 *   colour and is also used by protected rendering and photo mattes.
 * - Does not match rgb(), rgba(), hsl(), hwb(), lab(), lch(), oklch(),
 *   color-mix() results, named colours, or Tailwind class names.
 * - Does not scan images, fonts, lockfiles, tests, declaration files,
 *   dependencies, or build output.
 * - Scans product component source under app/ and components/ only.
 *   Library modules outside those trees are not covered.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const css = readFileSync("app/globals.css", "utf8");

const CANONICAL = [
  ["--brand-white", "#FFFFFF"],
  ["--brand-warm-white", "#FCF9F4"],
  ["--brand-charcoal", "#1F1F1F"],
  ["--brand-deep-teal", "#395E63"],
  ["--brand-sand-gold", "#F6DDA1"],
] as const;

const SEMANTIC = [
  ["--color-canvas", "--brand-white"],
  ["--color-canvas-warm", "--brand-warm-white"],
  ["--color-ink", "--brand-charcoal"],
  ["--color-ink-secondary", "--brand-deep-teal"],
  ["--color-action", "--brand-sand-gold"],
  ["--color-action-ink", "--brand-charcoal"],
] as const;

const THEME_COLOR_NAMES = [
  "background",
  "foreground",
  "canvas",
  "canvas-warm",
  "ink",
  "ink-secondary",
  "action",
  "action-ink",
  "action-hover",
  "action-pressed",
  "action-border",
] as const;

const PRESERVED_TAILWIND_FAMILIES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "white",
  "black",
] as const;

function distinctiveBrandHex(): RegExp {
  return /(?<![0-9A-Fa-f])#(?:fcf9f4|1f1f1f|395e63|f6dda1)(?![0-9A-Fa-f])/gi;
}
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "test-results",
  "out",
  "build",
]);

function themeBlock(): string {
  const start = css.indexOf("@theme inline {");
  assert.notEqual(start, -1);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    const char = css[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error("@theme inline block is unterminated");
}

function declarations(name: string): string[] {
  return css.match(new RegExp(`${name}\\s*:\\s*[^;]+;`, "g")) ?? [];
}

function mixChannels(goldShare: number): string {
  const gold = [246, 221, 161];
  const charcoal = [31, 31, 31];
  const channels = gold.map((channel, index) => Math.round(
    channel * goldShare + charcoal[index] * (1 - goldShare),
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.includes(".test.") || entry.name.includes(".spec.") || entry.name.endsWith(".d.ts")) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    found.push(fullPath);
  }
  return found;
}

test("canonical brand colours are declared once with their approved values", () => {
  for (const [name, value] of CANONICAL) {
    assert.deepEqual(declarations(name), [`${name}: ${value};`]);
    assert.equal(css.split(value).length - 1, 1, value);
  }
  const mediaAt = css.indexOf("@media (prefers-color-scheme: dark)");
  assert.ok(mediaAt > css.indexOf("--brand-sand-gold:"));
});

test("semantic colours alias canonical variables and do not repeat their hex values", () => {
  const theme = themeBlock();
  for (const [name, source] of SEMANTIC) {
    assert.equal(declarations(name).length, 1, name);
    assert.match(theme, new RegExp(`${name}:\\s*var\\(${source}\\);`));
  }
  assert.equal(theme.match(distinctiveBrandHex()), null);
  assert.doesNotMatch(theme, /#FFFFFF/i);
  assert.match(theme, /Provisional/);
});

test("provisional interaction colours derive from canonical variables", () => {
  assert.equal(mixChannels(0.92), "#E5CE97");
  assert.equal(mixChannels(0.84), "#D4BF8C");
  assert.match(css, /Hover mixes 92% Sand Gold with 8% Charcoal/);
  assert.match(css, /Pressed mixes 84% Sand Gold with 16% Charcoal/);
  assert.match(css, /#E5CE97/);
  assert.match(css, /#D4BF8C/);
  assert.deepEqual(declarations("--color-action-hover"), [
    "--color-action-hover: color-mix(in srgb, var(--brand-sand-gold) 92%, var(--brand-charcoal) 8%);",
  ]);
  assert.deepEqual(declarations("--color-action-pressed"), [
    "--color-action-pressed: color-mix(in srgb, var(--brand-sand-gold) 84%, var(--brand-charcoal) 16%);",
  ]);
  assert.deepEqual(declarations("--color-action-border"), [
    "--color-action-border: var(--brand-deep-teal);",
  ]);
});

test("viewport frame, page colours, dark mode, and type stay intact", () => {
  assert.deepEqual(declarations("--vibode-viewport-frame"), [
    "--vibode-viewport-frame: #38BDF8;",
  ]);
  assert.deepEqual(declarations("--background"), [
    "--background: #ffffff;",
    "--background: #0a0a0a;",
  ]);
  assert.deepEqual(declarations("--foreground"), [
    "--foreground: #171717;",
    "--foreground: #ededed;",
  ]);
  assert.deepEqual(declarations("--color-background"), [
    "--color-background: var(--background);",
  ]);
  assert.deepEqual(declarations("--color-foreground"), [
    "--color-foreground: var(--foreground);",
  ]);
  assert.match(css, /font-family: Arial, Helvetica, sans-serif;/);
  assert.equal(
    (css.match(/@media \(prefers-color-scheme: dark\)/g) ?? []).length,
    1,
  );
  const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  assert.match(media, /--background:\s*#0a0a0a;/);
  assert.match(media, /--foreground:\s*#ededed;/);
  assert.doesNotMatch(media, /--brand-/);
  assert.doesNotMatch(media, distinctiveBrandHex());
  assert.match(css, /\.precision-ring::after/);
  assert.match(css, /\.vibe-glow::after/);
  assert.match(css, /\.vibe-aura::before/);
  assert.match(css, /var\(--vibode-viewport-frame\)/);
  assert.match(css, /\.paste-to-place-pulse-ring/);
  assert.match(css, /rgba\(125, 211, 252, 0\.82\)/);
  assert.match(css, /rgba\(56, 189, 248, 0\.24\)/);
});

test("theme registration adds semantic names without redefining Tailwind palettes", () => {
  const declared = [...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((match) => match[1]);
  assert.deepEqual(declared, [...THEME_COLOR_NAMES]);
  assert.deepEqual(
    [...css.matchAll(/--font-([a-z0-9-]+)\s*:/g)].map((match) => match[1]),
    ["sans", "mono"],
  );
  for (const family of PRESERVED_TAILWIND_FAMILIES) {
    assert.doesNotMatch(css, new RegExp(`--color-${family}(?:-|\\s*:)`));
  }
});

test("distinctive brand hex values stay inside the canonical stylesheet", () => {
  const violations: string[] = [];
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(root)) {
      const relative = path.relative(process.cwd(), file);
      if (relative === path.normalize("app/globals.css")) continue;
      const source = readFileSync(file, "utf8");
      const matches = source.match(distinctiveBrandHex());
      if (matches) violations.push(`${relative}: ${matches.join(", ")}`);
    }
  }
  assert.deepEqual(violations, []);
});
