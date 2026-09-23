import assert from "node:assert/strict";
import test from "node:test";

import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "./contracts";
import {
  isAfcDiagnosticAdminReviewTransitionAllowed,
  normalizeAfcDiagnosticAdminReviewNotes,
  parseAfcDiagnosticAdminReviewPatchRequest,
  planAfcDiagnosticAdminReview,
  type AfcDiagnosticAdminReviewCurrentState,
} from "./admin-review";

const ADMIN_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_ADMIN = "66666666-6666-4666-8666-666666666666";
const NOW = "2026-09-20T18:00:00.000Z";
const REVIEWED_AT = "2026-09-19T13:00:00.000Z";

function current(
  overrides: Partial<AfcDiagnosticAdminReviewCurrentState> = {},
): AfcDiagnosticAdminReviewCurrentState {
  return {
    reviewStatus: "new",
    reviewerUserId: null,
    reviewNotes: null,
    reviewedAt: null,
    ...overrides,
  };
}

function parse(body: unknown) {
  return parseAfcDiagnosticAdminReviewPatchRequest(body);
}

function plan(
  state: AfcDiagnosticAdminReviewCurrentState,
  request: { reviewStatus: "new" | "in_review" | "closed"; reviewNotes: string | null },
) {
  return planAfcDiagnosticAdminReview({
    current: state,
    request,
    adminUserId: ADMIN_ID,
    now: NOW,
  });
}

test("valid request parses and freezes the DTO", () => {
  const parsed = parse({
    reviewStatus: "in_review",
    reviewNotes: "checking walls",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value, {
    reviewStatus: "in_review",
    reviewNotes: "checking walls",
  });
  assert.equal(Object.isFrozen(parsed.value), true);
});

test("non-object bodies are rejected", () => {
  for (const body of [null, undefined, "new", 1, true, ["reviewStatus"], []]) {
    assert.equal(parse(body).ok, false);
  }
});

test("missing reviewStatus or reviewNotes is rejected", () => {
  assert.equal(parse({ reviewNotes: null }).ok, false);
  assert.equal(parse({ reviewStatus: "new" }).ok, false);
  assert.equal(parse({}).ok, false);
});

test("unknown keys are rejected", () => {
  assert.equal(
    parse({
      reviewStatus: "new",
      reviewNotes: null,
      extra: true,
    }).ok,
    false,
  );
});

test("client reviewer keys are rejected", () => {
  for (const key of ["reviewerUserId", "reviewer_user_id"]) {
    assert.equal(
      parse({
        reviewStatus: "in_review",
        reviewNotes: null,
        [key]: ADMIN_ID,
      }).ok,
      false,
      key,
    );
  }
});

test("client reviewedAt keys are rejected", () => {
  for (const key of ["reviewedAt", "reviewed_at"]) {
    assert.equal(
      parse({
        reviewStatus: "closed",
        reviewNotes: null,
        [key]: NOW,
      }).ok,
      false,
      key,
    );
  }
});

test("client evidence keys are rejected", () => {
  for (const key of [
    "expectedUpdatedAt",
    "notes",
    "issueCodes",
    "trigger",
    "id",
    "roomId",
    "sessionId",
    "reportedGenerationId",
    "machineStatusSnapshot",
  ]) {
    assert.equal(
      parse({
        reviewStatus: "new",
        reviewNotes: null,
        [key]: "nope",
      }).ok,
      false,
      key,
    );
  }
});

test("invalid status is rejected", () => {
  for (const reviewStatus of [
    "New",
    "in-review",
    "resolved",
    "fixed",
    "done",
    "closed ",
    " new",
    "",
    null,
    1,
  ]) {
    assert.equal(
      parse({ reviewStatus, reviewNotes: null }).ok,
      false,
      String(reviewStatus),
    );
  }
});

test("invalid notes type is rejected", () => {
  for (const reviewNotes of [1, true, { text: "x" }, ["note"], undefined]) {
    assert.equal(
      parse({ reviewStatus: "new", reviewNotes }).ok,
      false,
    );
  }
});

test("notes are trimmed and whitespace-only becomes null", () => {
  const trimmed = parse({
    reviewStatus: "new",
    reviewNotes: "  checking walls  ",
  });
  assert.equal(trimmed.ok, true);
  if (trimmed.ok) assert.equal(trimmed.value.reviewNotes, "checking walls");

  const whitespace = parse({
    reviewStatus: "new",
    reviewNotes: " \n\t  ",
  });
  assert.equal(whitespace.ok, true);
  if (whitespace.ok) assert.equal(whitespace.value.reviewNotes, null);

  const empty = parse({
    reviewStatus: "new",
    reviewNotes: "",
  });
  assert.equal(empty.ok, true);
  if (empty.ok) assert.equal(empty.value.reviewNotes, null);

  const keptNull = parse({
    reviewStatus: "new",
    reviewNotes: null,
  });
  assert.equal(keptNull.ok, true);
  if (keptNull.ok) assert.equal(keptNull.value.reviewNotes, null);

  assert.equal(normalizeAfcDiagnosticAdminReviewNotes(null), null);
  assert.equal(normalizeAfcDiagnosticAdminReviewNotes(""), null);
  assert.equal(normalizeAfcDiagnosticAdminReviewNotes("  "), null);
  assert.equal(normalizeAfcDiagnosticAdminReviewNotes(" ok "), "ok");
});

test("exactly 2000 chars is accepted and 2001 is rejected", () => {
  const exact = "a".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS);
  const parsed = parse({ reviewStatus: "new", reviewNotes: exact });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.value.reviewNotes, exact);

  const paddedExact = `  ${exact}  `;
  const padded = parse({ reviewStatus: "new", reviewNotes: paddedExact });
  assert.equal(padded.ok, true);
  if (padded.ok) assert.equal(padded.value.reviewNotes, exact);

  assert.equal(
    parse({
      reviewStatus: "new",
      reviewNotes: "a".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS + 1),
    }).ok,
    false,
  );
  assert.equal(
    parse({
      reviewStatus: "new",
      reviewNotes: " ".repeat(AFC_DIAGNOSTIC_NOTES_MAX_CHARS + 1),
    }).ok,
    true,
  );
});

test("state machine allows the frozen transitions", () => {
  assert.equal(isAfcDiagnosticAdminReviewTransitionAllowed("new", "new"), true);
  assert.equal(isAfcDiagnosticAdminReviewTransitionAllowed("new", "in_review"), true);
  assert.equal(isAfcDiagnosticAdminReviewTransitionAllowed("new", "closed"), true);
  assert.equal(
    isAfcDiagnosticAdminReviewTransitionAllowed("in_review", "in_review"),
    true,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewTransitionAllowed("in_review", "closed"),
    true,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewTransitionAllowed("closed", "closed"),
    true,
  );
  assert.equal(
    isAfcDiagnosticAdminReviewTransitionAllowed("closed", "in_review"),
    true,
  );

  const newToNew = plan(current(), { reviewStatus: "new", reviewNotes: "note" });
  assert.equal(newToNew.ok, true);
  if (newToNew.ok) assert.equal(newToNew.noOp, false);

  const newToReview = plan(current(), {
    reviewStatus: "in_review",
    reviewNotes: null,
  });
  assert.equal(newToReview.ok && !newToReview.noOp, true);

  const newToClosed = plan(current(), {
    reviewStatus: "closed",
    reviewNotes: null,
  });
  assert.equal(newToClosed.ok && !newToClosed.noOp, true);

  const inReviewSame = plan(
    current({ reviewStatus: "in_review", reviewerUserId: ADMIN_ID }),
    { reviewStatus: "in_review", reviewNotes: "changed" },
  );
  assert.equal(inReviewSame.ok && !inReviewSame.noOp, true);

  const inReviewClosed = plan(
    current({ reviewStatus: "in_review", reviewerUserId: ADMIN_ID }),
    { reviewStatus: "closed", reviewNotes: null },
  );
  assert.equal(inReviewClosed.ok && !inReviewClosed.noOp, true);

  const closedSame = plan(
    current({
      reviewStatus: "closed",
      reviewerUserId: ADMIN_ID,
      reviewNotes: "done",
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "closed", reviewNotes: "updated" },
  );
  assert.equal(closedSame.ok && !closedSame.noOp, true);

  const reopen = plan(
    current({
      reviewStatus: "closed",
      reviewerUserId: OTHER_ADMIN,
      reviewNotes: "done",
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "in_review", reviewNotes: "done" },
  );
  assert.equal(reopen.ok && !reopen.noOp, true);
});

test("state machine rejects return to new", () => {
  assert.equal(
    isAfcDiagnosticAdminReviewTransitionAllowed("in_review", "new"),
    false,
  );
  assert.equal(isAfcDiagnosticAdminReviewTransitionAllowed("closed", "new"), false);

  const fromInReview = plan(
    current({ reviewStatus: "in_review", reviewerUserId: ADMIN_ID }),
    { reviewStatus: "new", reviewNotes: null },
  );
  assert.deepEqual(fromInReview, { ok: false, code: "illegal_transition" });

  const fromClosed = plan(
    current({
      reviewStatus: "closed",
      reviewerUserId: ADMIN_ID,
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "new", reviewNotes: "note" },
  );
  assert.deepEqual(fromClosed, { ok: false, code: "illegal_transition" });
});

test("same status and same normalized notes is a no-op", () => {
  const sameNull = plan(current(), { reviewStatus: "new", reviewNotes: null });
  assert.deepEqual(sameNull, { ok: true, noOp: true });

  const sameNote = plan(current({ reviewNotes: "hello" }), {
    reviewStatus: "new",
    reviewNotes: "hello",
  });
  assert.deepEqual(sameNote, { ok: true, noOp: true });

  const whitespaceEquivalent = plan(current({ reviewNotes: "hello" }), {
    reviewStatus: "new",
    reviewNotes: "hello",
  });
  const parsedWhitespace = parse({
    reviewStatus: "new",
    reviewNotes: "  hello  ",
  });
  assert.equal(parsedWhitespace.ok, true);
  if (parsedWhitespace.ok) {
    const planned = planAfcDiagnosticAdminReview({
      current: current({ reviewNotes: "hello" }),
      request: parsedWhitespace.value,
      adminUserId: ADMIN_ID,
      now: NOW,
    });
    assert.deepEqual(planned, { ok: true, noOp: true });
  }

  const currentWhitespace = plan(current({ reviewNotes: "  hello  " }), {
    reviewStatus: "new",
    reviewNotes: "hello",
  });
  assert.deepEqual(currentWhitespace, { ok: true, noOp: true });
  assert.deepEqual(whitespaceEquivalent, { ok: true, noOp: true });
});

test("new notes-only keeps reviewer null and reviewed_at unchanged", () => {
  const planned = plan(current(), {
    reviewStatus: "new",
    reviewNotes: "admin note",
  });
  assert.equal(planned.ok && planned.noOp === false, true);
  if (!planned.ok || planned.noOp) return;
  assert.deepEqual(planned.update, {
    review_status: "new",
    reviewer_user_id: null,
    review_notes: "admin note",
    reviewed_at: null,
  });

  const withExistingStamp = plan(
    current({ reviewedAt: REVIEWED_AT, reviewNotes: "old" }),
    { reviewStatus: "new", reviewNotes: "new note" },
  );
  assert.equal(withExistingStamp.ok && withExistingStamp.noOp === false, true);
  if (!withExistingStamp.ok || withExistingStamp.noOp) return;
  assert.equal(withExistingStamp.update.reviewer_user_id, null);
  assert.equal(withExistingStamp.update.reviewed_at, REVIEWED_AT);
});

test("in_review and closed mutations stamp the current admin and now", () => {
  const intoReview = plan(current(), {
    reviewStatus: "in_review",
    reviewNotes: null,
  });
  assert.equal(intoReview.ok && intoReview.noOp === false, true);
  if (!intoReview.ok || intoReview.noOp) return;
  assert.deepEqual(intoReview.update, {
    review_status: "in_review",
    reviewer_user_id: ADMIN_ID,
    review_notes: null,
    reviewed_at: NOW,
  });

  const intoClosed = plan(current(), {
    reviewStatus: "closed",
    reviewNotes: "closing",
  });
  assert.equal(intoClosed.ok && intoClosed.noOp === false, true);
  if (!intoClosed.ok || intoClosed.noOp) return;
  assert.equal(intoClosed.update.reviewer_user_id, ADMIN_ID);
  assert.equal(intoClosed.update.reviewed_at, NOW);

  const notesWhileInReview = plan(
    current({
      reviewStatus: "in_review",
      reviewerUserId: OTHER_ADMIN,
      reviewNotes: "old",
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "in_review", reviewNotes: "new" },
  );
  assert.equal(notesWhileInReview.ok && notesWhileInReview.noOp === false, true);
  if (!notesWhileInReview.ok || notesWhileInReview.noOp) return;
  assert.equal(notesWhileInReview.update.reviewer_user_id, ADMIN_ID);
  assert.equal(notesWhileInReview.update.reviewed_at, NOW);

  const notesWhileClosed = plan(
    current({
      reviewStatus: "closed",
      reviewerUserId: OTHER_ADMIN,
      reviewNotes: "old",
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "closed", reviewNotes: "new" },
  );
  assert.equal(notesWhileClosed.ok && notesWhileClosed.noOp === false, true);
  if (!notesWhileClosed.ok || notesWhileClosed.noOp) return;
  assert.equal(notesWhileClosed.update.reviewer_user_id, ADMIN_ID);
  assert.equal(notesWhileClosed.update.reviewed_at, NOW);
});

test("no-op does not alter reviewer or timestamp", () => {
  const state = current({
    reviewStatus: "in_review",
    reviewerUserId: OTHER_ADMIN,
    reviewNotes: "same",
    reviewedAt: REVIEWED_AT,
  });
  const planned = plan(state, {
    reviewStatus: "in_review",
    reviewNotes: "same",
  });
  assert.deepEqual(planned, { ok: true, noOp: true });
});

test("reopen closed -> in_review updates reviewer and timestamp even with same notes", () => {
  const planned = plan(
    current({
      reviewStatus: "closed",
      reviewerUserId: OTHER_ADMIN,
      reviewNotes: "keep me",
      reviewedAt: REVIEWED_AT,
    }),
    { reviewStatus: "in_review", reviewNotes: "keep me" },
  );
  assert.equal(planned.ok && planned.noOp === false, true);
  if (!planned.ok || planned.noOp) return;
  assert.deepEqual(planned.update, {
    review_status: "in_review",
    reviewer_user_id: ADMIN_ID,
    review_notes: "keep me",
    reviewed_at: NOW,
  });
});
