import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AfcDiagnosticInboxCaseNotes,
  AfcDiagnosticInboxCloseCaseControl,
  AfcDiagnosticInboxViewportThumbnail,
} from "@/app/admin/afc-diagnostics/AfcDiagnosticCaseInbox";
import {
  AFC_DIAGNOSTIC_INBOX_COPY,
  afcDiagnosticInboxCaseCanClose,
  afcDiagnosticInboxCaseNotesText,
  afcDiagnosticInboxViewportThumbnailUrl,
  suppressAfcDiagnosticInboxRowActivation,
} from "./admin-case-inbox.client";
import { defaultAfcDiagnosticVisualArtifactKind } from "./admin-visual-evidence.client";
import { afcDiagnosticAdminCaseViewport } from "./admin-read-model";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const GEN_1 = "11111111-1111-4111-8111-111111111111";

test("viewport kind matches the visual evidence default and drops bytes", () => {
  const combinations = [
    { emptyPresent: true, tiledPresent: true },
    { emptyPresent: true, tiledPresent: false },
    { emptyPresent: false, tiledPresent: true },
    { emptyPresent: false, tiledPresent: false },
  ] as const;
  for (const input of combinations) {
    const viewport = afcDiagnosticAdminCaseViewport({
      id: GEN_1,
      emptyPresent: input.emptyPresent,
      tiledPresent: input.tiledPresent,
      frame: { width: 4, height: 3 },
    });
    assert.equal(
      viewport.viewportArtifactKind,
      defaultAfcDiagnosticVisualArtifactKind(input),
    );
    assert.deepEqual(viewport.viewportFrame, { width: 4, height: 3 });
    assert.equal("sha256" in viewport, false);
  }
  assert.deepEqual(afcDiagnosticAdminCaseViewport(null), {
    viewportArtifactKind: null,
    viewportFrame: null,
  });
});

test("thumbnail URL reuses the admin artifact route only when a kind exists", () => {
  assert.equal(
    afcDiagnosticInboxViewportThumbnailUrl({
      caseId: CASE_1,
      generationId: GEN_1,
      kind: "empty",
    }),
    `/api/admin/afc-diagnostics/cases/${CASE_1}/generations/${GEN_1}/artifacts/empty`,
  );
  assert.equal(
    afcDiagnosticInboxViewportThumbnailUrl({
      caseId: CASE_1,
      generationId: GEN_1,
      kind: null,
    }),
    null,
  );
  assert.equal(afcDiagnosticInboxCaseCanClose("new"), true);
  assert.equal(afcDiagnosticInboxCaseCanClose("in_review"), true);
  assert.equal(afcDiagnosticInboxCaseCanClose("closed"), false);
});

test("notes preview keeps text and treats blank notes as empty", () => {
  assert.equal(afcDiagnosticInboxCaseNotesText(null), null);
  assert.equal(afcDiagnosticInboxCaseNotesText("   "), null);
  assert.equal(afcDiagnosticInboxCaseNotesText("walls drift"), "walls drift");

  const filled = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxCaseNotes, {
      notes: "walls drift left and the far edge bows",
    }),
  );
  assert.match(filled, /walls drift left and the far edge bows/);
  assert.match(filled, /line-clamp-2/);
  assert.match(filled, /max-w-\[18rem\]/);
  assert.match(filled, /data-afc-inbox-notes/);

  const empty = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxCaseNotes, { notes: null }),
  );
  assert.match(empty, /data-afc-inbox-notes/);
  assert.match(empty, /—/);
  assert.doesNotMatch(empty, /No notes provided/);
});

test("viewport thumbnail preserves the frame ratio and placeholders when absent", () => {
  const image = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxViewportThumbnail, {
      item: {
        caseId: CASE_1,
        reportedGenerationId: GEN_1,
        viewportArtifactKind: "empty",
        viewportFrame: { width: 1200, height: 800 },
      },
    }),
  );
  assert.match(image, /data-afc-inbox-viewport="image"/);
  assert.match(image, /object-contain/);
  assert.match(image, /aspect-ratio:1200 \/ 800/);
  assert.match(
    image,
    new RegExp(
      `src="/api/admin/afc-diagnostics/cases/${CASE_1}/generations/${GEN_1}/artifacts/empty"`,
    ),
  );
  assert.doesNotMatch(image, /signedUrl|storage_path/);
  assert.doesNotMatch(image, /<a /);

  const placeholder = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxViewportThumbnail, {
      item: {
        caseId: CASE_1,
        reportedGenerationId: GEN_1,
        viewportArtifactKind: null,
        viewportFrame: null,
      },
    }),
  );
  assert.match(placeholder, /data-afc-inbox-viewport="placeholder"/);
  assert.match(placeholder, /No viewport image/);
  assert.doesNotMatch(placeholder, /<img/);
});

test("close control is a button for open cases and the closed badge afterward", () => {
  let closed = 0;
  const open = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxCloseCaseControl, {
      caseId: CASE_1,
      reviewStatus: "in_review",
      pending: false,
      errorMessage: null,
      onClose: () => {
        closed += 1;
      },
    }),
  );
  assert.match(open, /data-afc-inbox-close-case/);
  assert.match(open, /type="button"/);
  assert.match(open, new RegExp(`>${AFC_DIAGNOSTIC_INBOX_COPY.close}<`));
  assert.match(open, /aria-label="Close Case dcd4dbd9"/);
  assert.doesNotMatch(open, />Close Case</);
  assert.doesNotMatch(open, /<a /);
  assert.equal(closed, 0);

  const pending = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxCloseCaseControl, {
      caseId: CASE_1,
      reviewStatus: "new",
      pending: true,
      errorMessage: null,
      onClose: () => {
        closed += 1;
      },
    }),
  );
  assert.match(pending, /disabled/);
  assert.match(pending, /Closing\.\.\./);
  assert.match(pending, /aria-busy="true"/);

  const alreadyClosed = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxCloseCaseControl, {
      caseId: CASE_1,
      reviewStatus: "closed",
      pending: false,
      errorMessage: null,
      onClose: () => {
        closed += 1;
      },
    }),
  );
  assert.match(alreadyClosed, /data-afc-inbox-closed-status/);
  assert.match(alreadyClosed, />Closed</);
  assert.doesNotMatch(alreadyClosed, /data-afc-inbox-close-case/);
  assert.equal(closed, 0);
});

test("close activation does not continue into row navigation", () => {
  let prevented = 0;
  let stopped = 0;
  suppressAfcDiagnosticInboxRowActivation({
    preventDefault: () => {
      prevented += 1;
    },
    stopPropagation: () => {
      stopped += 1;
    },
  });
  assert.equal(prevented, 1);
  assert.equal(stopped, 1);
});
