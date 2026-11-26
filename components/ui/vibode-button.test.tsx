/**
 * Static markup checks for the Vibode button primitives.
 *
 * The repository test runner has no DOM, so this file cannot press a button,
 * move keyboard focus, or apply a hover, pressed, or reduced-motion state.
 * Those interactions are certified here only as native attributes and classes.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  VIBODE_BUTTON_SIZES,
  VIBODE_BUTTON_VARIANTS,
  VibodeButton,
  type VibodeButtonSize,
  type VibodeButtonVariant,
} from "./VibodeButton";
import { VibodeIconButton } from "./VibodeIconButton";

const BUTTON_FILES = [
  "components/ui/VibodeButton.tsx",
  "components/ui/VibodeIconButton.tsx",
];

const VARIANT_CLASSES: Record<VibodeButtonVariant, string[]> = {
  primary: [
    "bg-action",
    "text-action-ink",
    "border-action-border",
    "hover:bg-action-hover",
    "active:bg-action-pressed",
  ],
  secondary: [
    "bg-action-secondary",
    "text-action-secondary-ink",
    "hover:bg-action-secondary-hover",
    "active:bg-action-secondary-pressed",
  ],
  outline: [
    "bg-canvas",
    "text-ink-secondary",
    "border-ink-secondary",
    "hover:bg-quiet-hover",
    "active:bg-quiet-pressed",
  ],
  tertiary: [
    "bg-transparent",
    "text-ink-secondary",
    "hover:bg-quiet-hover",
    "active:bg-quiet-pressed",
  ],
  destructive: [
    "bg-danger",
    "text-danger-ink",
    "border-2",
    "border-danger-border",
    "hover:bg-danger-hover",
    "active:bg-danger-pressed",
  ],
  tool: [
    "bg-tool",
    "text-tool-ink",
    "hover:bg-tool-hover",
    "active:bg-tool-pressed",
  ],
};

const SIZE_CLASSES: Record<VibodeButtonSize, string[]> = {
  compact: ["h-8", "px-2.5", "text-xs"],
  standard: ["h-10", "px-3.5", "text-sm"],
  large: ["h-11", "px-4", "text-sm"],
};

const ICON_SIZE_CLASSES: Record<VibodeButtonSize, string[]> = {
  compact: ["size-8", "px-0"],
  standard: ["size-10", "px-0"],
  large: ["size-11", "px-0"],
};

const PRODUCT_REFERENCE = [
  "VibodeButton",
  "VibodeIconButton",
  "vibodeButtonClassName",
  "bg-action",
  "text-action-ink",
  "border-action-border",
  "bg-action-secondary",
  "bg-tool",
  "bg-quiet",
  "bg-danger",
  "text-danger-ink",
  "outline-focus",
];

function render(node: ReactElement): string {
  return renderToStaticMarkup(node);
}

function buttonClasses(markup: string): Set<string> {
  const match = markup.match(/<button\b[^>]*\sclass="([^"]*)"/);
  assert.ok(match, markup);
  return new Set(match[1].split(/\s+/));
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
    if (!entry.isFile()) continue;
    if (entry.name.includes(".test.") || entry.name.endsWith(".d.ts")) continue;
    if (!/\.(?:ts|tsx|js|jsx|mjs|css)$/.test(entry.name)) continue;
    found.push(fullPath);
  }
  return found;
}

test("variants and sizes map to semantic classes", () => {
  for (const variant of VIBODE_BUTTON_VARIANTS) {
    const markup = render(createElement(VibodeButton, { variant }, "Save"));
    const classes = buttonClasses(markup);
    for (const token of VARIANT_CLASSES[variant]) {
      assert.equal(classes.has(token), true, `${variant} ${token}`);
    }
    assert.match(markup, new RegExp(`data-variant="${variant}"`));
    if (variant === "tool") {
      assert.equal(classes.has("bg-action"), false);
    }
    if (variant === "primary") {
      assert.equal(classes.has("bg-tool"), false);
    }
    if (variant !== "destructive") {
      assert.equal(classes.has("border-2"), false, variant);
    }
  }

  for (const size of VIBODE_BUTTON_SIZES) {
    const classes = buttonClasses(render(createElement(VibodeButton, { size }, "Save")));
    for (const token of SIZE_CLASSES[size]) {
      assert.equal(classes.has(token), true, `${size} ${token}`);
    }
    assert.equal(classes.has("rounded-[8px]"), true);
    assert.equal(classes.has("font-semibold"), true);
    assert.equal(classes.has("gap-2"), true);
    assert.equal(classes.has("duration-150"), true);
  }
});

test("buttons keep native type, disabled, and focus behaviour", () => {
  const idle = render(createElement(VibodeButton, null, "Save"));
  assert.match(idle, /<button\b/);
  assert.match(idle, /type="button"/);
  assert.doesNotMatch(idle, /\sdisabled(?:=|>|\s)/);
  assert.equal(buttonClasses(idle).has("focus-visible:outline-focus"), true);
  assert.equal(buttonClasses(idle).has("motion-reduce:transition-none"), true);
  assert.equal([...buttonClasses(idle)].some((name) => name.startsWith("shadow")), false);

  assert.match(
    render(createElement(VibodeButton, { type: "submit", name: "intent", value: "save" }, "Save")),
    /type="submit"[^>]*name="intent"[^>]*value="save"|type="submit"/,
  );
  const submit = render(createElement(VibodeButton, { type: "submit", name: "intent", value: "save" }, "Save"));
  assert.match(submit, /type="submit"/);
  assert.match(submit, /name="intent"/);
  assert.match(submit, /value="save"/);
  assert.match(render(createElement(VibodeButton, { type: "reset" }, "Reset")), /type="reset"/);

  const disabled = render(createElement(VibodeButton, { disabled: true }, "Save"));
  assert.match(disabled, /\sdisabled=""/);
  assert.equal(buttonClasses(disabled).has("disabled:cursor-not-allowed"), true);
  assert.equal(buttonClasses(disabled).has("disabled:opacity-50"), true);
});

test("selected state is opt-in and is not communicated by colour alone", () => {
  const action = render(createElement(VibodeButton, null, "Save"));
  assert.doesNotMatch(action, /aria-pressed/);
  assert.equal([...buttonClasses(action)].some((name) => name.startsWith("shadow")), false);

  const on = render(createElement(VibodeButton, { selected: true }, "Saved"));
  assert.match(on, /aria-pressed="true"/);
  assert.equal(
    buttonClasses(on).has("shadow-[inset_0_-2px_0_0_currentColor]"),
    true,
  );

  const off = render(createElement(VibodeButton, { selected: false }, "Save"));
  assert.match(off, /aria-pressed="false"/);
  assert.equal([...buttonClasses(off)].some((name) => name.startsWith("shadow")), false);

  const tool = buttonClasses(render(createElement(VibodeButton, { variant: "tool", selected: true }, "Move")));
  assert.equal(tool.has("bg-tool"), true);
  assert.equal(tool.has("bg-action"), false);
  assert.equal(tool.has("shadow-[inset_0_-2px_0_0_currentColor]"), true);
});

test("icon buttons require an accessible name and hide the icon", () => {
  const markup = render(
    <VibodeIconButton label=" Close panel ">
      <svg aria-label="ignored" />
    </VibodeIconButton>,
  );
  assert.match(markup, /aria-label="Close panel"/);
  assert.match(markup, /<span[^>]*aria-hidden="true"[^>]*>/);
  assert.match(markup, /<svg/);
  assert.doesNotMatch(markup, /aria-pressed/);
  const classes = buttonClasses(markup);
  for (const token of ICON_SIZE_CLASSES.standard) {
    assert.equal(classes.has(token), true, token);
  }
  assert.equal(classes.has("px-3.5"), false);

  for (const size of VIBODE_BUTTON_SIZES) {
    const iconClasses = buttonClasses(
      render(
        <VibodeIconButton label="Close" size={size}>
          <svg />
        </VibodeIconButton>,
      ),
    );
    for (const token of ICON_SIZE_CLASSES[size]) {
      assert.equal(iconClasses.has(token), true, `${size} ${token}`);
    }
  }

  assert.throws(
    () => render(<VibodeIconButton label="   ">x</VibodeIconButton>),
    /non-empty accessible name/,
  );
});

test("button source uses semantic tokens and leaves product screens untouched", () => {
  const source = BUTTON_FILES.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /#[0-9A-Fa-f]{3,8}\b/);
  assert.doesNotMatch(source, /#(?:38BDF8|FF00FF|f5c518|3d7eff)/i);
  assert.match(source, /border-action-border/);
  assert.match(source, /The primary Deep Teal border is provisional/);

  const owned = new Set(BUTTON_FILES.map((file) => path.normalize(file)));
  const violations: string[] = [];
  for (const root of ["app", "components"]) {
    for (const file of sourceFiles(root)) {
      const relative = path.relative(process.cwd(), file);
      if (owned.has(path.normalize(relative))) continue;
      if (relative === path.normalize("app/dev") || relative.startsWith(`${path.normalize("app/dev")}${path.sep}`)) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      const hits = PRODUCT_REFERENCE.filter((token) => text.includes(token));
      if (hits.length > 0) violations.push(`${relative}: ${hits.join(", ")}`);
    }
  }
  assert.deepEqual(violations, []);

  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /--vibode-viewport-frame:\s*#38BDF8;/);
  assert.match(css, /--background:\s*#0a0a0a;/);
  assert.match(css, /--foreground:\s*#ededed;/);
  const script = JSON.parse(readFileSync("package.json", "utf8")).scripts["test:ui"];
  assert.equal(
    script,
    "node --import tsx --test --test-concurrency=1 lib/brand-tokens.test.ts components/ui/vibode-button.test.tsx app/dev/design-studio/design-studio-route.test.ts",
  );
});
