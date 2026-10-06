import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { visualEvidenceSourceButtonClassName } from "@/app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence";
import {
  AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS,
  defaultAfcDiagnosticVisualArtifactKind,
  type AfcDiagnosticVisualArtifactKind,
} from "@/lib/afc-v2-diagnostics/admin-visual-evidence.client";

const VISUAL = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticVisualEvidence.tsx",
);

const ACTIVE_BORDER = "border-emerald-400/80";
const ACTIVE_TEXT = "text-emerald-200";
const HOVER_BORDER = "hover:border-emerald-400/80";
const HOVER_TEXT = "hover:text-emerald-200";
const INACTIVE_BORDER = "border-slate-700";
const INACTIVE_TEXT = "text-slate-200";
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-emerald-400/80";

function sourceButtonStates(selected: AfcDiagnosticVisualArtifactKind) {
  return AFC_DIAGNOSTIC_VISUAL_ARTIFACT_KINDS.map((candidate) => {
    const active = candidate === selected;
    return {
      candidate,
      active,
      pressed: active,
      className: visualEvidenceSourceButtonClassName(active),
    };
  });
}

function assertExclusiveActive(selected: AfcDiagnosticVisualArtifactKind) {
  const states = sourceButtonStates(selected);
  const active = states.filter((state) => state.active);
  assert.equal(active.length, 1);
  assert.equal(active[0]?.candidate, selected);
  assert.equal(active[0]?.pressed, true);
  assert.match(active[0]?.className ?? "", new RegExp(`\\b${ACTIVE_BORDER}\\b`));
  assert.match(active[0]?.className ?? "", new RegExp(`\\b${ACTIVE_TEXT}\\b`));
  assert.match(active[0]?.className ?? "", new RegExp(HOVER_BORDER));
  assert.match(active[0]?.className ?? "", new RegExp(HOVER_TEXT));
  assert.doesNotMatch(active[0]?.className ?? "", new RegExp(`\\b${INACTIVE_BORDER}\\b`));
  assert.doesNotMatch(active[0]?.className ?? "", new RegExp(`\\b${INACTIVE_TEXT}\\b`));
  assert.match(active[0]?.className ?? "", new RegExp(FOCUS_RING));

  for (const state of states.filter((entry) => entry.candidate !== selected)) {
    assert.equal(state.active, false);
    assert.equal(state.pressed, false);
    assert.match(state.className, new RegExp(`\\b${INACTIVE_BORDER}\\b`));
    assert.match(state.className, new RegExp(`\\b${INACTIVE_TEXT}\\b`));
    assert.match(state.className, new RegExp(HOVER_BORDER));
    assert.match(state.className, new RegExp(HOVER_TEXT));
    assert.match(state.className, new RegExp(FOCUS_RING));
    assert.doesNotMatch(
      state.className,
      new RegExp(`(?<!hover:)\\b${ACTIVE_BORDER}\\b`),
    );
  }
}

test("default selected source uses the persistent green active classes", () => {
  const selected = defaultAfcDiagnosticVisualArtifactKind({
    emptyPresent: true,
    tiledPresent: true,
  });
  assert.equal(selected, "empty");
  assertExclusiveActive(selected);
});

test("ORIGINAL active leaves EMPTY and TILED inactive", () => {
  assertExclusiveActive("original");
});

test("EMPTY active leaves ORIGINAL and TILED inactive", () => {
  assertExclusiveActive("empty");
});

test("TILED active leaves ORIGINAL and EMPTY inactive", () => {
  assertExclusiveActive("tiled");
});

test("source tabs derive active styling and aria-pressed from kind only", () => {
  const visual = readFileSync(VISUAL, "utf8");
  assert.match(
    visual,
    /aria-pressed=\{kind === candidate\}/,
  );
  assert.match(
    visual,
    /className=\{visualEvidenceSourceButtonClassName\(kind === candidate\)\}/,
  );
  assert.match(
    visual,
    /onClick=\{\(\) => \{\s*if \(candidate === kind\) return;\s*setKind\(candidate\);\s*\}\}/,
  );
  assert.match(visual, /focus-visible:ring-emerald-400\/80/);
  assert.equal((visual.match(/await fetch\(/g) ?? []).length, 2);
  assert.match(visual, /AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY\.floor/);
  assert.match(visual, /AFC_DIAGNOSTIC_VISUAL_OVERLAY_COPY\.collision/);
  assert.match(visual, /AFC_DIAGNOSTIC_METRIC_SPAN_COPY\.label/);
  assert.match(visual, /className=\{buttonClassName\}/);
  assert.doesNotMatch(visual, /supabase\/migrations/);
});
