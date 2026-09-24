import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AfcDiagnosticInboxClosedVisibilityButton } from "@/app/admin/afc-diagnostics/AfcDiagnosticCaseInbox";
import type { AfcDiagnosticAdminCaseSummary } from "./admin-read-model";
import {
  AFC_DIAGNOSTIC_ADMIN_CASES_PATH,
  AFC_DIAGNOSTIC_INBOX_COPY,
  buildAfcDiagnosticInboxListUrl,
  countAfcDiagnosticInboxClosedCases,
  emptyAfcDiagnosticInboxCommittedFilters,
  afcDiagnosticInboxClosedVisibilityLabel,
  afcDiagnosticInboxEffectiveShowClosed,
  afcDiagnosticInboxEmptyStateUsesFilterCopy,
  afcDiagnosticInboxShowsClosedVisibilityToggle,
  applyAfcDiagnosticInboxSelectFilter,
  filterAfcDiagnosticCasesByClosedVisibility,
} from "./admin-case-inbox.client";

const INBOX = path.join(
  process.cwd(),
  "app/admin/afc-diagnostics/AfcDiagnosticCaseInbox.tsx",
);
const HELPER = path.join(
  process.cwd(),
  "lib/afc-v2-diagnostics/admin-case-inbox.client.ts",
);
const LIST_ROUTE = path.join(
  process.cwd(),
  "app/api/admin/afc-diagnostics/cases/route.ts",
);
const READ_SERVER = path.join(
  process.cwd(),
  "lib/afc-v2-diagnostics/admin-read-model.server.ts",
);

const CASE_NEW = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const CASE_CLOSED = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const CASE_REVIEW = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
const CASE_CLOSED_OTHER = "f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";

function summary(
  overrides: Partial<AfcDiagnosticAdminCaseSummary> = {},
): AfcDiagnosticAdminCaseSummary {
  return {
    caseId: CASE_NEW,
    submittedAt: "2026-09-18T12:00:00.000Z",
    reviewStatus: "new",
    trigger: "manual_report",
    origin: "tester",
    issueCodes: ["perspective_off"],
    taxonomyVersion: "afc-qa-issue-taxonomy/v1",
    hasNotes: false,
    roomId: ROOM_A,
    sessionId: SESSION_A,
    sessionStatus: "open",
    sessionAttemptCount: 2,
    reportedGenerationId: GEN_A,
    machineStatusSnapshot: "ready",
    reporterUserId: USER_A,
    ...overrides,
  };
}

function queue() {
  return [
    summary({ caseId: CASE_NEW, reviewStatus: "new", sessionStatus: "closed" }),
    summary({ caseId: CASE_CLOSED, reviewStatus: "closed", issueCodes: ["perspective_off"] }),
    summary({ caseId: CASE_REVIEW, reviewStatus: "in_review" }),
    summary({
      caseId: CASE_CLOSED_OTHER,
      reviewStatus: "closed",
      issueCodes: ["scale_incorrect"],
    }),
  ];
}

test("default closed visibility hides closed review rows and keeps the rest", () => {
  const cases = queue();
  const before = cases.map((item) => ({
    caseId: item.caseId,
    reviewStatus: item.reviewStatus,
  }));
  const showClosed = false;
  assert.equal(showClosed, false);
  const visible = filterAfcDiagnosticCasesByClosedVisibility(cases, showClosed);
  assert.deepEqual(
    visible.map((item) => item.caseId),
    [CASE_NEW, CASE_REVIEW],
  );
  assert.equal(
    visible.some((item) => item.reviewStatus === "closed"),
    false,
  );
  assert.deepEqual(
    cases.map((item) => ({ caseId: item.caseId, reviewStatus: item.reviewStatus })),
    before,
  );
  assert.notEqual(visible, cases);
});

test("showing closed includes them in the original order without mutating status", () => {
  const cases = queue();
  let showClosed = false;
  assert.equal(
    afcDiagnosticInboxClosedVisibilityLabel(showClosed, 0),
    AFC_DIAGNOSTIC_INBOX_COPY.showClosed,
  );
  assert.equal(
    afcDiagnosticInboxClosedVisibilityLabel(showClosed, countAfcDiagnosticInboxClosedCases(cases)),
    "Show closed (2)",
  );
  showClosed = true;
  const visible = filterAfcDiagnosticCasesByClosedVisibility(cases, showClosed);
  assert.equal(visible, cases);
  assert.deepEqual(
    visible.map((item) => item.caseId),
    [CASE_NEW, CASE_CLOSED, CASE_REVIEW, CASE_CLOSED_OTHER],
  );
  assert.equal(afcDiagnosticInboxClosedVisibilityLabel(showClosed, 2), "Hide closed");
  showClosed = false;
  const hiddenAgain = filterAfcDiagnosticCasesByClosedVisibility(cases, showClosed);
  assert.deepEqual(
    hiddenAgain.map((item) => item.caseId),
    [CASE_NEW, CASE_REVIEW],
  );
  assert.equal(cases[1].reviewStatus, "closed");
  assert.equal(cases[3].reviewStatus, "closed");
});

test("closed visibility composes with an already applied issue filter", () => {
  const issueFiltered = queue().filter((item) =>
    item.issueCodes.includes("perspective_off"),
  );
  const hidden = filterAfcDiagnosticCasesByClosedVisibility(issueFiltered, false);
  assert.deepEqual(
    hidden.map((item) => item.caseId),
    [CASE_NEW, CASE_REVIEW],
  );
  const shown = filterAfcDiagnosticCasesByClosedVisibility(issueFiltered, true);
  assert.deepEqual(
    shown.map((item) => item.caseId),
    [CASE_NEW, CASE_CLOSED, CASE_REVIEW],
  );
  assert.equal(
    shown.some((item) => item.caseId === CASE_CLOSED_OTHER),
    false,
  );
});

test("only closed cases use the filtered empty state until show closed", () => {
  const cases = [summary({ caseId: CASE_CLOSED, reviewStatus: "closed" })];
  const hidden = filterAfcDiagnosticCasesByClosedVisibility(cases, false);
  assert.equal(hidden.length, 0);
  assert.equal(
    afcDiagnosticInboxEmptyStateUsesFilterCopy({
      hasCommittedFilters: false,
      showClosed: false,
      loadedCount: cases.length,
      visibleCount: hidden.length,
    }),
    true,
  );
  const shown = filterAfcDiagnosticCasesByClosedVisibility(cases, true);
  assert.equal(shown.length, 1);
  assert.equal(shown[0], cases[0]);
  assert.equal(
    afcDiagnosticInboxEmptyStateUsesFilterCopy({
      hasCommittedFilters: false,
      showClosed: true,
      loadedCount: cases.length,
      visibleCount: shown.length,
    }),
    false,
  );
  assert.equal(
    afcDiagnosticInboxEmptyStateUsesFilterCopy({
      hasCommittedFilters: false,
      showClosed: false,
      loadedCount: 0,
      visibleCount: 0,
    }),
    false,
  );
});

function visibleIds(
  cases: readonly AfcDiagnosticAdminCaseSummary[],
  showClosed: boolean,
  committedReviewStatus: "new" | "in_review" | "closed" | null,
) {
  return filterAfcDiagnosticCasesByClosedVisibility(
    cases,
    afcDiagnosticInboxEffectiveShowClosed(showClosed, committedReviewStatus),
  ).map((item) => item.caseId);
}

test("applied Review=Closed shows closed rows without the local toggle", () => {
  const cases = queue();
  const closedIds = [CASE_CLOSED, CASE_CLOSED_OTHER];
  assert.deepEqual(visibleIds(cases, false, null), [CASE_NEW, CASE_REVIEW]);
  assert.deepEqual(visibleIds(cases, false, "closed"), [
    CASE_NEW,
    CASE_CLOSED,
    CASE_REVIEW,
    CASE_CLOSED_OTHER,
  ]);
  assert.deepEqual(visibleIds(cases, true, "closed"), [
    CASE_NEW,
    CASE_CLOSED,
    CASE_REVIEW,
    CASE_CLOSED_OTHER,
  ]);
  assert.equal(afcDiagnosticInboxShowsClosedVisibilityToggle("closed"), false);
  assert.equal(afcDiagnosticInboxShowsClosedVisibilityToggle(null), true);
  assert.equal(afcDiagnosticInboxShowsClosedVisibilityToggle("new"), true);
  assert.equal(afcDiagnosticInboxShowsClosedVisibilityToggle("in_review"), true);
  assert.deepEqual(visibleIds(cases, false, "new"), [CASE_NEW, CASE_REVIEW]);
  assert.deepEqual(visibleIds(cases, true, "new"), cases.map((item) => item.caseId));
  assert.deepEqual(visibleIds(cases, false, "in_review"), [CASE_NEW, CASE_REVIEW]);
  assert.deepEqual(visibleIds(cases, true, "in_review"), cases.map((item) => item.caseId));
  assert.deepEqual(visibleIds(cases, false, null), [CASE_NEW, CASE_REVIEW]);
  assert.deepEqual(visibleIds(cases, true, null), cases.map((item) => item.caseId));
  assert.deepEqual(closedIds.filter((id) => visibleIds(cases, false, "new").includes(id)), []);

  const onlyClosed = [summary({ caseId: CASE_CLOSED, reviewStatus: "closed" })];
  const shown = filterAfcDiagnosticCasesByClosedVisibility(
    onlyClosed,
    afcDiagnosticInboxEffectiveShowClosed(false, "closed"),
  );
  assert.equal(shown.length, 1);
  assert.equal(shown[0].reviewStatus, "closed");
  assert.equal(
    afcDiagnosticInboxEmptyStateUsesFilterCopy({
      hasCommittedFilters: true,
      showClosed: true,
      loadedCount: onlyClosed.length,
      visibleCount: shown.length,
    }),
    false,
  );
});

test("an unapplied Review selection does not change effective visibility", () => {
  const committed = emptyAfcDiagnosticInboxCommittedFilters();
  assert.equal(committed.reviewStatus, null);
  assert.equal(afcDiagnosticInboxEffectiveShowClosed(false, committed.reviewStatus), false);
  const applied = applyAfcDiagnosticInboxSelectFilter(committed, "reviewStatus", "closed");
  assert.equal(applied.reviewStatus, "closed");
  assert.equal(committed.reviewStatus, null);
  assert.equal(afcDiagnosticInboxEffectiveShowClosed(false, applied.reviewStatus), true);
  const withIssue = applyAfcDiagnosticInboxSelectFilter(
    applied,
    "issueCode",
    "perspective_off",
  );
  const payload = queue().filter(
    (item) =>
      item.reviewStatus === "closed" && item.issueCodes.includes("perspective_off"),
  );
  assert.deepEqual(
    visibleIds(payload, false, withIssue.reviewStatus),
    [CASE_CLOSED],
  );
  assert.equal(
    visibleIds(payload, false, withIssue.reviewStatus).includes(CASE_CLOSED_OTHER),
    false,
  );
});

test("closed visibility button exposes pressed state and the standard button name", () => {
  const hidden = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxClosedVisibilityButton, {
      showClosed: false,
      closedCount: 7,
      onToggle: () => {
        throw new Error("toggle must not run during static render");
      },
    }),
  );
  assert.match(hidden, /aria-pressed="false"/);
  assert.match(hidden, /type="button"/);
  assert.match(hidden, />Show closed \(7\)</);
  assert.doesNotMatch(hidden, /onKeyDown|role="switch"/);

  const shown = renderToStaticMarkup(
    createElement(AfcDiagnosticInboxClosedVisibilityButton, {
      showClosed: true,
      closedCount: 7,
      onToggle: () => undefined,
    }),
  );
  assert.match(shown, /aria-pressed="true"/);
  assert.match(shown, />Hide closed</);
  assert.match(shown, /border-emerald-400\/80/);
});

test("inbox toggle is local display state and does not fetch or mutate review", () => {
  const inbox = readFileSync(INBOX, "utf8");
  const helper = readFileSync(HELPER, "utf8");
  const route = readFileSync(LIST_ROUTE, "utf8");
  const server = readFileSync(READ_SERVER, "utf8");
  assert.match(inbox, /const \[showClosed, setShowClosed\] = useState\(false\)/);
  assert.match(
    inbox,
    /afcDiagnosticInboxEffectiveShowClosed\(\s*showClosed,\s*committed\.reviewStatus,\s*\)/,
  );
  assert.match(
    inbox,
    /filterAfcDiagnosticCasesByClosedVisibility\(items, effectiveShowClosed\)/,
  );
  assert.match(
    inbox,
    /afcDiagnosticInboxShowsClosedVisibilityToggle\(committed\.reviewStatus\)/,
  );
  assert.doesNotMatch(inbox, /useEffect\(\(\) => setShowClosed/);
  assert.doesNotMatch(inbox, /draftReview/);
  assert.match(inbox, /visibleCases\.map/);
  assert.match(
    inbox,
    /onToggle=\{\(\) => setShowClosed\(\(current\) => !current\)\}/,
  );
  assert.match(inbox, /\[committed, committedKey, runFetch\]/);
  assert.equal((inbox.match(/await fetch\(/g) ?? []).length, 1);
  assert.doesNotMatch(inbox, /localStorage|searchParams\.set\("showClosed"/);
  assert.doesNotMatch(helper, /localStorage|params\.set\("showClosed"/);
  assert.doesNotMatch(inbox, /method:\s*["'](POST|PATCH|PUT|DELETE)["']/);
  assert.doesNotMatch(inbox, /patchAfcDiagnosticAdminCaseReview|review\/route/);
  assert.equal(
    buildAfcDiagnosticInboxListUrl(emptyAfcDiagnosticInboxCommittedFilters()),
    AFC_DIAGNOSTIC_ADMIN_CASES_PATH,
  );
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PATCH)/);
  assert.match(server, /if \(query\.reviewStatus\)/);
  assert.doesNotMatch(server, /\.neq\(\s*["']review_status["']/);
});
