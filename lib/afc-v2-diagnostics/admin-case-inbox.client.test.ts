import assert from "node:assert/strict";
import test from "node:test";

import type { AfcDiagnosticAdminCaseSummary } from "./admin-read-model";
import {
  AFC_DIAGNOSTIC_ADMIN_CASES_PATH,
  AFC_DIAGNOSTIC_INBOX_COPY,
  AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS,
  AFC_DIAGNOSTIC_INBOX_PAGE_PATH,
  applyAfcDiagnosticInboxSelectFilter,
  afcDiagnosticInboxAttemptLabel,
  afcDiagnosticInboxHasCommittedFilters,
  afcDiagnosticInboxIssueDisplay,
  afcDiagnosticInboxIssueLabel,
  afcDiagnosticInboxLoadErrorMessage,
  afcDiagnosticInboxMachineLabel,
  afcDiagnosticInboxOriginLabel,
  afcDiagnosticInboxReviewLabel,
  afcDiagnosticInboxSessionStatusLabel,
  afcDiagnosticInboxSourceText,
  afcDiagnosticInboxTriggerLabel,
  buildAfcDiagnosticInboxListUrl,
  buildAfcDiagnosticInboxPageHref,
  createAfcDiagnosticInboxRequestCoordinator,
  emptyAfcDiagnosticInboxCommittedFilters,
  formatAfcDiagnosticInboxSubmittedAt,
  isAfcDiagnosticInboxAbortError,
  isAfcDiagnosticInboxUuid,
  isoTimestampToLocalDateInput,
  localDateInputToIsoEnd,
  localDateInputToIsoStart,
  mergeAfcDiagnosticInboxItems,
  parseAfcDiagnosticInboxCommittedFilters,
  parseAfcDiagnosticInboxListPayload,
  parseAfcDiagnosticInboxUuid,
  parseLocalDateOnlyInput,
  serializeAfcDiagnosticInboxCommittedFilters,
  shortAfcDiagnosticUuid,
  shouldCommitAfcDiagnosticInboxRequest,
  validateAfcDiagnosticInboxDraftFilters,
} from "./admin-case-inbox.client";
import { AFC_QA_TESTER_ISSUE_OPTIONS } from "./tester-report.client";

const CASE_1 = "dcd4dbd9-916f-4d70-ac12-bd718be3adce";
const CASE_2 = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2";
const ROOM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GEN_A = "11111111-1111-4111-8111-111111111111";
const USER_A = "22222222-2222-4222-8222-222222222222";

function summary(
  overrides: Partial<AfcDiagnosticAdminCaseSummary> = {},
): AfcDiagnosticAdminCaseSummary {
  return {
    caseId: CASE_1,
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

test("short UUID shows the first 8 characters", () => {
  assert.equal(shortAfcDiagnosticUuid(CASE_1), "dcd4dbd9");
  assert.equal(shortAfcDiagnosticUuid(ROOM_A), "aaaaaaaa");
});

test("UUID validation accepts canonical UUIDs and lowercases them", () => {
  assert.equal(isAfcDiagnosticInboxUuid(CASE_1), true);
  assert.equal(parseAfcDiagnosticInboxUuid(CASE_1.toUpperCase()), CASE_1);
  assert.equal(parseAfcDiagnosticInboxUuid("not-a-uuid"), null);
  assert.equal(parseAfcDiagnosticInboxUuid(" dcd4dbd9-916f-4d70-ac12-bd718be3adce "), CASE_1);
  assert.equal(isAfcDiagnosticInboxUuid("abc"), false);
});

test("issue labels reuse tester-facing copy", () => {
  assert.equal(
    afcDiagnosticInboxIssueLabel("perspective_off").label,
    "Perspective looks wrong",
  );
  assert.equal(
    afcDiagnosticInboxIssueLabel("wall_edges_unrecognized").label,
    "Wall edges aren’t being recognized",
  );
  assert.equal(
    afcDiagnosticInboxIssueLabel("scale_incorrect").label,
    "Scale looks incorrect",
  );
  assert.equal(afcDiagnosticInboxIssueLabel("other").label, "Other");
  assert.deepEqual(
    AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS.map((option) => option.label),
    AFC_QA_TESTER_ISSUE_OPTIONS.map((option) => option.label),
  );
});

test("unknown issue falls back without using snake_case as the visible label", () => {
  const unknown = afcDiagnosticInboxIssueLabel("not_a_real_issue");
  assert.equal(unknown.label, "Unknown issue");
  assert.equal(unknown.title, "not_a_real_issue");
  assert.notEqual(unknown.label, "not_a_real_issue");
});

test("multiple issue rendering shows two chips and +N overflow in canonical order", () => {
  const display = afcDiagnosticInboxIssueDisplay([
    "other",
    "perspective_off",
    "scale_incorrect",
    "not_a_real_issue",
  ]);
  assert.equal(display.chips.length, 2);
  assert.equal(display.chips[0]?.key, "perspective_off");
  assert.equal(display.chips[0]?.label, "Perspective looks wrong");
  assert.equal(display.chips[1]?.key, "scale_incorrect");
  assert.equal(display.overflowCount, 2);
  assert.match(display.title, /Perspective looks wrong/);
  assert.match(display.title, /Unknown issue/);
  assert.doesNotMatch(display.chips[0]?.label ?? "", /perspective_off/);
});

test("review, trigger, origin, machine, and session labels", () => {
  assert.equal(afcDiagnosticInboxReviewLabel("new"), "New");
  assert.equal(afcDiagnosticInboxReviewLabel("in_review"), "In review");
  assert.equal(afcDiagnosticInboxReviewLabel("closed"), "Closed");
  assert.equal(afcDiagnosticInboxTriggerLabel("manual_report"), "Manual report");
  assert.equal(
    afcDiagnosticInboxTriggerLabel("repeated_unsuccessful"),
    "Repeated unsuccessful",
  );
  assert.equal(afcDiagnosticInboxTriggerLabel("admin_capture"), "Capture");
  assert.equal(afcDiagnosticInboxOriginLabel("tester"), "Tester");
  assert.equal(afcDiagnosticInboxOriginLabel("admin"), "Admin");
  assert.equal(
    afcDiagnosticInboxSourceText("tester", "manual_report"),
    "Tester · Manual report",
  );
  assert.equal(
    afcDiagnosticInboxSourceText("tester", "repeated_unsuccessful"),
    "Tester · Repeated unsuccessful",
  );
  assert.equal(
    afcDiagnosticInboxSourceText("admin", "admin_capture"),
    "Admin · Capture",
  );
  assert.equal(afcDiagnosticInboxMachineLabel("running"), "Running");
  assert.equal(afcDiagnosticInboxMachineLabel("ready"), "Ready");
  assert.equal(afcDiagnosticInboxMachineLabel("failed"), "Failed");
  assert.equal(afcDiagnosticInboxSessionStatusLabel("open"), "Open");
  assert.equal(afcDiagnosticInboxSessionStatusLabel("closed"), "Closed");
});

test("attempt labels are descriptive and do not infer dissatisfaction", () => {
  assert.equal(afcDiagnosticInboxAttemptLabel(1), "1 attempt");
  assert.equal(afcDiagnosticInboxAttemptLabel(2), "2 attempts");
  assert.equal(afcDiagnosticInboxAttemptLabel(0), "0 attempts");
});

test("submitted local time formatting and invalid fallback", () => {
  const valid = formatAfcDiagnosticInboxSubmittedAt("2026-09-18T12:00:00.000Z");
  assert.equal(valid.title, "2026-09-18T12:00:00.000Z");
  assert.notEqual(valid.display, "—");
  assert.match(valid.display, /2026/);
  const invalid = formatAfcDiagnosticInboxSubmittedAt("not-a-date");
  assert.equal(invalid.display, "—");
  assert.equal(invalid.title, "not-a-date");
});

test("date-only local start/end convert to ISO and round-trip", () => {
  const start = localDateInputToIsoStart("2026-09-19");
  const end = localDateInputToIsoEnd("2026-09-19");
  assert.ok(start);
  assert.ok(end);
  const startDate = new Date(start);
  const endDate = new Date(end);
  assert.equal(startDate.getFullYear(), 2026);
  assert.equal(startDate.getMonth(), 8);
  assert.equal(startDate.getDate(), 19);
  assert.equal(startDate.getHours(), 0);
  assert.equal(startDate.getMinutes(), 0);
  assert.equal(startDate.getSeconds(), 0);
  assert.equal(startDate.getMilliseconds(), 0);
  assert.equal(endDate.getHours(), 23);
  assert.equal(endDate.getMinutes(), 59);
  assert.equal(endDate.getSeconds(), 59);
  assert.equal(endDate.getMilliseconds(), 999);
  assert.equal(isoTimestampToLocalDateInput(start), "2026-09-19");
  assert.equal(isoTimestampToLocalDateInput(end), "2026-09-19");
  assert.ok(Date.parse(start) < Date.parse(end));
});

test("invalid date input is rejected", () => {
  assert.equal(parseLocalDateOnlyInput("2026-13-40"), null);
  assert.equal(parseLocalDateOnlyInput("not-a-date"), null);
  assert.equal(parseLocalDateOnlyInput("2026-02-31"), null);
  assert.equal(localDateInputToIsoStart("2026-02-31"), null);
  assert.equal(localDateInputToIsoEnd(""), null);
  const invalid = validateAfcDiagnosticInboxDraftFilters({
    roomId: "",
    submittedFrom: "2026-02-31",
    submittedTo: "",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.message, AFC_DIAGNOSTIC_INBOX_COPY.invalidDate);
  }
});

test("URL committed filter parser reads certified params and ignores unknown", () => {
  const parsed = parseAfcDiagnosticInboxCommittedFilters(
    new URLSearchParams(
      "reviewStatus=new&trigger=manual_report&issueCode=perspective_off&machineStatusSnapshot=ready&roomId=" +
        ROOM_A.toUpperCase() +
        "&submittedFrom=2026-09-19T00:00:00.000Z&submittedTo=2026-09-19T23:59:59.999Z&foo=bar&cursor=abc&limit=25&origin=tester",
    ),
  );
  assert.equal(parsed.reviewStatus, "new");
  assert.equal(parsed.trigger, "manual_report");
  assert.equal(parsed.issueCode, "perspective_off");
  assert.equal(parsed.machineStatusSnapshot, "ready");
  assert.equal(parsed.roomId, ROOM_A);
  assert.equal(parsed.submittedFrom, "2026-09-19T00:00:00.000Z");
  assert.equal(parsed.submittedTo, "2026-09-19T23:59:59.999Z");
  assert.equal("cursor" in parsed, false);
  assert.equal("limit" in parsed, false);
  assert.equal("foo" in parsed, false);
  assert.equal("origin" in parsed, false);
});

test("parser ignores invalid enum, room, and timestamp values rather than forwarding them", () => {
  const parsed = parseAfcDiagnosticInboxCommittedFilters(
    new URLSearchParams(
      "reviewStatus=nope&trigger=nope&issueCode=nope&machineStatusSnapshot=nope&roomId=bad&submittedFrom=nope&submittedTo=also-nope",
    ),
  );
  assert.deepEqual(parsed, emptyAfcDiagnosticInboxCommittedFilters());
});

test("serializer omits empty params, unknown params, cursor, and limit", () => {
  const params = serializeAfcDiagnosticInboxCommittedFilters({
    ...emptyAfcDiagnosticInboxCommittedFilters(),
    reviewStatus: "new",
    issueCode: "perspective_off",
  });
  assert.equal(params.get("reviewStatus"), "new");
  assert.equal(params.get("issueCode"), "perspective_off");
  assert.equal(params.get("trigger"), null);
  assert.equal(params.get("cursor"), null);
  assert.equal(params.get("limit"), null);
  assert.equal(params.get("origin"), null);
  const href = buildAfcDiagnosticInboxPageHref({
    ...emptyAfcDiagnosticInboxCommittedFilters(),
    reviewStatus: "new",
  });
  assert.equal(href, `${AFC_DIAGNOSTIC_INBOX_PAGE_PATH}?reviewStatus=new`);
  assert.doesNotMatch(href, /cursor|limit/);
  const emptyHref = buildAfcDiagnosticInboxPageHref(
    emptyAfcDiagnosticInboxCommittedFilters(),
  );
  assert.equal(emptyHref, AFC_DIAGNOSTIC_INBOX_PAGE_PATH);
});

test("room UUID is lowercased in committed filters and list URLs", () => {
  const parsed = parseAfcDiagnosticInboxCommittedFilters(
    new URLSearchParams(`roomId=${ROOM_A.toUpperCase()}`),
  );
  assert.equal(parsed.roomId, ROOM_A);
  const url = buildAfcDiagnosticInboxListUrl(parsed);
  assert.match(url, new RegExp(`roomId=${ROOM_A}`));
  assert.doesNotMatch(url, /[A-F]/);
});

test("list API URL builder uses certified params and adds cursor only when requested", () => {
  const filters = parseAfcDiagnosticInboxCommittedFilters(
    new URLSearchParams("reviewStatus=new&issueCode=perspective_off&foo=1&cursor=nope"),
  );
  assert.equal(
    buildAfcDiagnosticInboxListUrl(filters),
    `${AFC_DIAGNOSTIC_ADMIN_CASES_PATH}?reviewStatus=new&issueCode=perspective_off`,
  );
  assert.equal(
    buildAfcDiagnosticInboxListUrl(filters, "next-cursor"),
    `${AFC_DIAGNOSTIC_ADMIN_CASES_PATH}?reviewStatus=new&issueCode=perspective_off&cursor=next-cursor`,
  );
  assert.equal(
    buildAfcDiagnosticInboxListUrl(emptyAfcDiagnosticInboxCommittedFilters()),
    AFC_DIAGNOSTIC_ADMIN_CASES_PATH,
  );
});

test("list payload parser accepts the certified shape and rejects malformed payloads", () => {
  const parsed = parseAfcDiagnosticInboxListPayload({
    items: [summary(), { ...summary({ caseId: CASE_2 }), extra: "ignored" }],
    nextCursor: "abc",
    unexpected: true,
  });
  assert.ok(parsed);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.nextCursor, "abc");
  assert.equal("extra" in parsed.items[1]!, false);
  assert.equal(parseAfcDiagnosticInboxListPayload(null), null);
  assert.equal(parseAfcDiagnosticInboxListPayload({ items: [] }), null);
  assert.equal(
    parseAfcDiagnosticInboxListPayload({
      items: [{ ...summary(), caseId: "bad" }],
      nextCursor: null,
    }),
    null,
  );
  const emptyCursor = parseAfcDiagnosticInboxListPayload({
    items: [],
    nextCursor: "",
  });
  assert.ok(emptyCursor);
  assert.equal(emptyCursor.nextCursor, null);
});

test("merge/dedupe keeps first occurrence and preserves order", () => {
  const first = summary({ caseId: CASE_1, sessionAttemptCount: 1 });
  const second = summary({ caseId: CASE_2, sessionAttemptCount: 2 });
  const duplicate = summary({ caseId: CASE_1, sessionAttemptCount: 9 });
  const third = summary({
    caseId: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
    sessionAttemptCount: 3,
  });
  const merged = mergeAfcDiagnosticInboxItems([first, second], [duplicate, third]);
  assert.deepEqual(
    merged.map((item) => item.caseId),
    [CASE_1, CASE_2, third.caseId],
  );
  assert.equal(merged[0]?.sessionAttemptCount, 1);
});

test("room UUID draft validation blocks requests without calling the API", () => {
  const invalid = validateAfcDiagnosticInboxDraftFilters({
    roomId: "not-a-uuid",
    submittedFrom: "",
    submittedTo: "",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.message, AFC_DIAGNOSTIC_INBOX_COPY.invalidRoomId);
  }
  const valid = validateAfcDiagnosticInboxDraftFilters({
    roomId: ROOM_A.toUpperCase(),
    submittedFrom: "",
    submittedTo: "",
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.roomId, ROOM_A);
  }
});

test("submitted from must be before submitted to", () => {
  const invalid = validateAfcDiagnosticInboxDraftFilters({
    roomId: "",
    submittedFrom: "2026-09-20",
    submittedTo: "2026-09-19",
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.message, AFC_DIAGNOSTIC_INBOX_COPY.invalidDateRange);
  }
  const sameDay = validateAfcDiagnosticInboxDraftFilters({
    roomId: "",
    submittedFrom: "2026-09-19",
    submittedTo: "2026-09-19",
  });
  assert.equal(sameDay.ok, true);
});

test("error status mapping does not print raw API bodies", () => {
  assert.equal(afcDiagnosticInboxLoadErrorMessage(401), AFC_DIAGNOSTIC_INBOX_COPY.error401);
  assert.equal(afcDiagnosticInboxLoadErrorMessage(403), AFC_DIAGNOSTIC_INBOX_COPY.error403);
  assert.equal(afcDiagnosticInboxLoadErrorMessage(400), AFC_DIAGNOSTIC_INBOX_COPY.error400);
  assert.equal(afcDiagnosticInboxLoadErrorMessage(500), AFC_DIAGNOSTIC_INBOX_COPY.errorGeneric);
  assert.equal(
    afcDiagnosticInboxLoadErrorMessage("network"),
    AFC_DIAGNOSTIC_INBOX_COPY.errorGeneric,
  );
});

test("stale request seq cannot overwrite a newer request", () => {
  assert.equal(shouldCommitAfcDiagnosticInboxRequest(2, 1), false);
  assert.equal(shouldCommitAfcDiagnosticInboxRequest(2, 2), true);
});

test("request coordinator aborts replace requests and blocks concurrent load-more", () => {
  const coordinator = createAfcDiagnosticInboxRequestCoordinator();
  const first = coordinator.begin("page1");
  assert.equal(first.started, true);
  if (!first.started) return;
  const second = coordinator.begin("refresh");
  assert.equal(second.started, true);
  if (!second.started) return;
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.equal(coordinator.isCurrent(first.seq), false);
  assert.equal(coordinator.isCurrent(second.seq), true);
  coordinator.finish(second.seq);
  const more = coordinator.begin("more", true);
  assert.equal(more.started, false);
});

test("AbortError is recognized and should not be treated as a user error", () => {
  assert.equal(isAfcDiagnosticInboxAbortError({ name: "AbortError" }), true);
  assert.equal(isAfcDiagnosticInboxAbortError(new Error("boom")), false);
  assert.equal(isAfcDiagnosticInboxAbortError(null), false);
});

test("select Any omits the committed enum filter", () => {
  const selected = applyAfcDiagnosticInboxSelectFilter(
    {
      ...emptyAfcDiagnosticInboxCommittedFilters(),
      reviewStatus: "closed",
    },
    "reviewStatus",
    "in_review",
  );
  assert.equal(selected.reviewStatus, "in_review");
  const cleared = applyAfcDiagnosticInboxSelectFilter(
    selected,
    "reviewStatus",
    "",
  );
  assert.equal(cleared.reviewStatus, null);
});

test("hasCommittedFilters distinguishes unfiltered empty copy", () => {
  assert.equal(
    afcDiagnosticInboxHasCommittedFilters(emptyAfcDiagnosticInboxCommittedFilters()),
    false,
  );
  assert.equal(
    afcDiagnosticInboxHasCommittedFilters({
      ...emptyAfcDiagnosticInboxCommittedFilters(),
      reviewStatus: "closed",
    }),
    true,
  );
});
