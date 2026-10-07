import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AFC_QA_TESTER_COPY,
  createInitialAfcQaTesterReportModel,
  deriveAfcQaTesterReportView,
  reduceAfcQaTesterReport,
  type AfcQaBrowserState,
} from "./tester-report.client";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "qa-stage-controls-test-anon-key";

const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROOM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN = "11111111-1111-4111-8111-111111111111";

const AUTHORIZED: AfcQaBrowserState = {
  enabled: true,
  canReport: true,
  offerFeedback: false,
  reportGenerationId: GEN,
};

const DENIED: AfcQaBrowserState = {
  enabled: false,
  canReport: false,
  offerFeedback: false,
  reportGenerationId: null,
};

function viewFor(
  projection: AfcQaBrowserState,
  roomId = ROOM_A,
  preparePhase: string | null = "ready",
) {
  const model = reduceAfcQaTesterReport(createInitialAfcQaTesterReportModel(roomId), {
    type: "projection_ready",
    projection,
  }).state;
  return deriveAfcQaTesterReportView(model, {
    preparePhase,
    prepareGenerationId: preparePhase === "ready" ? GEN : null,
  });
}

async function render(view: ReturnType<typeof deriveAfcQaTesterReportView>) {
  const { AfcQaTesterReportView } = await import("@/components/afc-qa/AfcQaTesterReport");
  return renderToStaticMarkup(createElement(AfcQaTesterReportView, {
    view,
    onOpenManual: () => undefined,
    onOpenAutomatic: () => undefined,
    onDismissAutomatic: () => undefined,
    onCancelForm: () => undefined,
    onToggleIssue: () => undefined,
    onNotesChange: () => undefined,
    onSubmit: () => undefined,
    onRerun: () => undefined,
    onPerspectiveReread: () => undefined,
  }));
}

test("authorized STAGE markup shows Report Issue, Re-read Perspective, and Re-run Room Read", async () => {
  const html = await render(viewFor(AUTHORIZED));
  assert.match(html, new RegExp(AFC_QA_TESTER_COPY.manualButton));
  assert.match(html, new RegExp(AFC_QA_TESTER_COPY.rereadButton));
  assert.match(html, new RegExp(AFC_QA_TESTER_COPY.rerunButton));
  assert.match(html, /data-afc-qa-manual-entry="true"/);
  assert.match(html, /data-afc-qa-perspective-reread="true"/);
  assert.match(html, /data-afc-qa-ready-rerun="true"/);
});

test("unauthorized markup renders no QA controls", async () => {
  const html = await render(viewFor(DENIED));
  assert.equal(html, "");
  assert.doesNotMatch(html, /Report Issue|Re-read Perspective|Re-run Room Read/);
});

test("changing rooms does not keep a denied projection or drop a later authorization", () => {
  const first = reduceAfcQaTesterReport(createInitialAfcQaTesterReportModel(ROOM_A), {
    type: "projection_ready",
    projection: AUTHORIZED,
  }).state;
  const changed = reduceAfcQaTesterReport(first, {
    type: "room_changed",
    roomId: ROOM_B,
  }).state;
  assert.equal(changed.roomId, ROOM_B);
  assert.equal(changed.projection, null);
  assert.equal(
    deriveAfcQaTesterReportView(changed, {
      preparePhase: "ready",
      prepareGenerationId: GEN,
    }).showManualReport,
    false,
  );
  const next = reduceAfcQaTesterReport(changed, {
    type: "projection_ready",
    projection: AUTHORIZED,
  }).state;
  const view = deriveAfcQaTesterReportView(next, {
    preparePhase: "ready",
    prepareGenerationId: GEN,
  });
  assert.equal(view.showManualReport, true);
  assert.equal(view.showPerspectiveReread, true);
  assert.equal(view.showRerun, true);
  const denied = deriveAfcQaTesterReportView(
    reduceAfcQaTesterReport(next, {
      type: "projection_ready",
      projection: DENIED,
    }).state,
    { preparePhase: "ready", prepareGenerationId: GEN },
  );
  assert.equal(denied.showManualReport, false);
  assert.equal(denied.showRerun, false);
});

test("Re-run and Re-read stay unavailable until the room generation is ready", () => {
  const waiting = viewFor(AUTHORIZED, ROOM_A, "running");
  assert.equal(waiting.showManualReport, true);
  assert.equal(waiting.showRerun, false);
  assert.equal(waiting.showPerspectiveReread, false);
  const idle = viewFor({
    enabled: true,
    canReport: false,
    offerFeedback: false,
    reportGenerationId: null,
  });
  assert.equal(idle.showManualReport, false);
  assert.equal(idle.showRerun, false);
  assert.equal(idle.showPerspectiveReread, false);
});
