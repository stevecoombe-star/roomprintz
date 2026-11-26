/**
 * Locks the Design Studio to the development server.
 * The production HTTP status is verified separately against `next start`.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { assertDesignStudioDevelopmentOnly } from "../dev-only";
import DesignStudioPage from "./page";

const STUDIO_FILES = [
  "app/dev/dev-only.ts",
  "app/dev/layout.tsx",
  "app/dev/design-studio/page.tsx",
  "app/dev/design-studio/design-studio.tsx",
];

function isAuthorizedMyRoomsAdoption(relative: string): boolean {
  const normalized = path.normalize(relative);
  return (
    normalized.startsWith(`${path.normalize("components/my-rooms")}${path.sep}`) ||
    normalized.startsWith(`${path.normalize("app/my-rooms")}${path.sep}`)
  );
}

const ALLOWED_BUTTON_IMPORTS = new Set([
  path.normalize("components/ui/VibodeButton.tsx"),
  path.normalize("components/ui/VibodeIconButton.tsx"),
  path.normalize("app/dev/design-studio/page.tsx"),
  path.normalize("app/dev/design-studio/design-studio.tsx"),
]);

function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function assignEnv(value: string | undefined) {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

function withNodeEnv(value: string | undefined, run: () => void) {
  const previous = process.env.NODE_ENV;
  assignEnv(value);
  try {
    run();
  } finally {
    assignEnv(previous);
  }
}

function expectNotFound(run: () => void) {
  assert.throws(run, (error: unknown) => {
    assert.equal(typeof error, "object");
    assert.match(String((error as { digest?: string }).digest), /;404$/);
    return true;
  });
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || entry.name.includes(".test.") || entry.name.endsWith(".d.ts")) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|css)$/.test(entry.name)) continue;
    found.push(fullPath);
  }
  return found;
}

test("the design studio gate rejects every non-development server", () => {
  for (const value of ["production", "test", undefined]) {
    withNodeEnv(value, () => {
      expectNotFound(() => assertDesignStudioDevelopmentOnly());
      expectNotFound(() => DesignStudioPage());
    });
  }

  withNodeEnv("development", () => {
    assert.doesNotThrow(() => assertDesignStudioDevelopmentOnly());
    const html = render(createElement(DesignStudioPage));
    for (const variant of ["primary", "secondary", "outline", "tertiary", "destructive", "tool"]) {
      assert.match(html, new RegExp(`data-variant="${variant}"`));
    }
    for (const size of ["compact", "standard", "large"]) {
      assert.match(html, new RegExp(`data-size="${size}"`));
    }
    assert.match(html, /Development only/);
    assert.match(html, /data-section="palette"/);
    assert.match(html, /data-section="certification"/);
    assert.match(html, /data-section="exploration"/);
    assert.match(html, /data-section="interaction"/);
    assert.match(html, /data-section="toolbar"/);
    assert.match(html, /data-section="icon-selection"/);
    assert.match(html, /data-demo="icon-tool-compact-move"/);
    assert.match(html, /data-demo="icon-tool-large-size"/);
    assert.match(html, /aria-label="Pinned tool"/);
    assert.match(html, /data-token="--brand-sand-gold"/);
    assert.match(html, /data-token="--support-danger"/);
    assert.match(html, /aria-label="Catalog"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-pressed="false"/);
    assert.match(html, /type="submit"/);
    assert.match(html, /type="reset"/);
    assert.match(html, /\sdisabled=""/);
    assert.match(html, /data-experiment="surface-white"/);
    assert.match(html, /data-experiment="surface-warm-white"/);
    assert.match(html, /data-experiment="border-none"/);
    assert.match(html, /data-experiment="radius-8"/);
    assert.match(html, /data-experiment="toolbar-28"/);
    const ordinary = html.match(/<button\b[^>]*>Start New Room<\/button>/);
    assert.ok(ordinary);
    assert.doesNotMatch(ordinary[0], /aria-pressed/);
  });
});

test("the gate stays on the server and product screens stay unchanged", () => {
  const gate = readFileSync("app/dev/dev-only.ts", "utf8");
  assert.match(gate, /process\.env\.NODE_ENV !== "development"/);
  assert.match(gate, /notFound\(\)/);
  assert.doesNotMatch(gate, /NEXT_PUBLIC_/);
  assert.doesNotMatch(gate, /DESIGN_STUDIO/);

  for (const file of ["app/dev/layout.tsx", "app/dev/design-studio/page.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /assertDesignStudioDevelopmentOnly/);
    assert.match(source, /force-dynamic/);
    assert.doesNotMatch(source, /"use client"/);
  }

  const studioSource = STUDIO_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(studioSource, /#(?:fcf9f4|1f1f1f|395e63|f6dda1|ffffff|9f1239)/i);

  const proxy = readFileSync("proxy.ts", "utf8");
  assert.doesNotMatch(proxy, /\/dev/);

  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /--brand-white:\s*#FFFFFF;/);
  assert.match(css, /--brand-warm-white:\s*#FCF9F4;/);
  assert.match(css, /--brand-charcoal:\s*#1F1F1F;/);
  assert.match(css, /--brand-deep-teal:\s*#395E63;/);
  assert.match(css, /--brand-sand-gold:\s*#F6DDA1;/);
  assert.match(css, /--vibode-viewport-frame:\s*#38BDF8;/);

  const violations: string[] = [];
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(root)) {
      const relative = path.normalize(path.relative(process.cwd(), file));
      if (ALLOWED_BUTTON_IMPORTS.has(relative) || isAuthorizedMyRoomsAdoption(relative)) continue;
      const text = readFileSync(file, "utf8");
      if (/\bVibodeButton\b|\bVibodeIconButton\b|<DesignStudio\b|design-studio/.test(text)) {
        violations.push(relative);
      }
    }
  }
  assert.deepEqual(violations, []);
  assert.equal(isAuthorizedMyRoomsAdoption("components/my-rooms/MyRoomsHeader.tsx"), true);
  assert.equal(isAuthorizedMyRoomsAdoption("components/my-furniture/MyFurniturePageClient.tsx"), false);
  assert.equal(isAuthorizedMyRoomsAdoption("app/editor/page.tsx"), false);
});
