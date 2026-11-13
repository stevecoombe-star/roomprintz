import assert from "node:assert/strict";
import test from "node:test";

import { beginDecision, claimDecision, markedDecision, operatorDecision } from "./admission";

const ATTEMPT = "99999999-9999-4999-8999-999999999999";

test("admission readers accept only the deletion barrier contract", () => {
  assert.deepEqual(beginDecision({ ok: true, code: "begun", attempt_id: ATTEMPT, phase: "admitted" }), {
    status: "ready",
    attemptId: ATTEMPT,
    phase: "admitted",
  });
  assert.deepEqual(beginDecision({ ok: true, code: "in_progress", attempt_id: ATTEMPT.toUpperCase(), phase: "destructive" }), {
    status: "ready",
    attemptId: ATTEMPT,
    phase: "destructive",
  });
  assert.equal(beginDecision({ ok: false, code: "unsettled_hold" }).status, "blocked");
  assert.equal(beginDecision({ ok: false, code: "not_found" }).status, "missing");
  assert.equal(beginDecision({ ok: true, blocked: false }).status, "unavailable");
  assert.equal(beginDecision({ ok: true, code: "begun", attempt_id: "users/secret", phase: "admitted" }).status, "unavailable");

  assert.equal(claimDecision({ ok: true, phase: "admitted" }), "claimed");
  assert.equal(claimDecision({ ok: false, code: "deletion_in_progress" }), "busy");
  assert.equal(claimDecision({ ok: false, code: "attempt_mismatch" }), "unavailable");
  assert.equal(markedDecision({ ok: true, phase: "destructive" }), "marked");
  assert.equal(markedDecision({ ok: false, code: "deletion_in_progress" }), "unavailable");

  assert.equal(operatorDecision({ ok: true }).status, "ok");
  assert.equal(operatorDecision({ ok: false, code: "attempt_mismatch" }).status, "mismatch");
  assert.equal(operatorDecision({ ok: false, code: "cleanup_started" }).status, "cleanup_started");
  assert.equal(operatorDecision({ ok: false, code: "deletion_in_progress" }).status, "busy");
  assert.equal(operatorDecision({ ok: false, code: "not_found" }).status, "missing");
  assert.equal(operatorDecision({ ok: false, message: "users/secret/model.glb" }).status, "unavailable");
});
