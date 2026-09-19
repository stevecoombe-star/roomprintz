import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AfcGenerationIntent, AfcGenerationStatus } from "../afc-v2-production/production-store";
import {
  AFC_DIAGNOSTIC_CASE_EVIDENCE_FIELDS,
  AFC_DIAGNOSTIC_CASE_REVIEW_FIELDS,
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_CASE_TRIGGERS,
  AFC_DIAGNOSTIC_MACHINE_STATUS_SNAPSHOTS,
  AFC_DIAGNOSTIC_NOTES_MAX_CHARS,
  AFC_DIAGNOSTIC_REVIEW_STATUSES,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_INTENTS,
  AFC_DIAGNOSTIC_SESSION_STATUSES,
  AFC_DIAGNOSTIC_SESSION_TABLE,
  AFC_QA_ISSUE_CODE_LABELS,
  AFC_QA_ISSUE_CODES,
  AFC_QA_ISSUE_TAXONOMY_VERSION,
  isAfcDiagnosticNotes,
  isAfcDiagnosticReviewStatus,
  isAfcQaIssueCode,
  validateAfcQaIssueTaxonomy,
} from "./index";

const ROOT = process.cwd();
const AFD1A_MIGRATION =
  "supabase/migrations/20260921120000_vibode_afc_v2_diagnostic_foundation.sql";
const AFC_PRODUCTION_MIGRATION =
  "supabase/migrations/20260908213000_vibode_afc_v2_production_generations.sql";

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function withoutComments(sql: string) {
  return sql.replace(/--[^\n]*/g, "");
}

function walkTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

function tableBody(sql: string, table: string) {
  const match = sql.match(
    new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\);`),
  );
  assert.ok(match, `expected create table public.${table}`);
  return match[1];
}

function functionBody(sql: string, name: string) {
  const match = sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\(\\)[\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$`,
    ),
  );
  assert.ok(match, `expected function public.${name}`);
  return match[1];
}

const MIGRATION = source(AFD1A_MIGRATION);
const PRODUCTION_MIGRATION = source(AFC_PRODUCTION_MIGRATION);
const SESSION_BODY = tableBody(MIGRATION, AFC_DIAGNOSTIC_SESSION_TABLE);
const MEMBERSHIP_BODY = tableBody(MIGRATION, AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE);
const CASE_BODY = tableBody(MIGRATION, AFC_DIAGNOSTIC_CASE_TABLE);

test("1) sessions schema contains required fields", () => {
  assert.match(MIGRATION, /create table public\.vibode_afc_diagnostic_sessions/);
  assert.match(SESSION_BODY, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(
    SESSION_BODY,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    SESSION_BODY,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.match(SESSION_BODY, /original_sha256 text not null/);
  assert.match(SESSION_BODY, /base_asset_id uuid null/);
  assert.match(SESSION_BODY, /status text not null default 'open'/);
  assert.match(SESSION_BODY, /created_at timestamptz not null default now\(\)/);
  assert.match(SESSION_BODY, /updated_at timestamptz not null default now\(\)/);
  assert.match(
    MIGRATION,
    /create trigger set_timestamp_vibode_afc_diagnostic_sessions\s+before update on public\.vibode_afc_diagnostic_sessions\s+for each row execute function public\.set_timestamp\(\)/,
  );
  assert.match(
    MIGRATION,
    /create index vibode_afc_diagnostic_sessions_user_room_sha_created_desc_idx\s+on public\.vibode_afc_diagnostic_sessions \(\s+user_id,\s+room_id,\s+original_sha256,\s+created_at desc\s+\)/,
  );
  assert.deepEqual([...AFC_DIAGNOSTIC_SESSION_STATUSES], ["open", "closed"]);
});

test("2) session status is limited to open/closed", () => {
  assert.match(
    SESSION_BODY,
    /constraint vibode_afc_diagnostic_sessions_status_closed\s+check \(status in \('open', 'closed'\)\)/,
  );
  assert.doesNotMatch(SESSION_BODY, /promoted|in_review|running/);
});

test("3) at most one open session per user/room/original sha", () => {
  assert.match(
    MIGRATION,
    /create unique index vibode_afc_diagnostic_sessions_one_open_uidx\s+on public\.vibode_afc_diagnostic_sessions \(user_id, room_id, original_sha256\)\s+where status = 'open'/,
  );
  assert.doesNotMatch(
    withoutComments(MIGRATION),
    /\b(idle|timeout|inactivity|rotation)\b/,
  );
});

test("4) base_asset_id is snapshot-only with no FK authority", () => {
  assert.match(SESSION_BODY, /base_asset_id uuid null/);
  assert.doesNotMatch(SESSION_BODY, /base_asset_id[\s\S]*references/);
  assert.doesNotMatch(SESSION_BODY, /active_asset_id|base_version_id|furniture/);
  assert.doesNotMatch(MIGRATION, /diagnostic source authority/);
});

test("5) session room and user deletion cascades", () => {
  assert.match(
    SESSION_BODY,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    SESSION_BODY,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
});

test("6) a generation belongs to at most one diagnostic session", () => {
  assert.match(
    MEMBERSHIP_BODY,
    /primary key \(session_id, generation_id\)/,
  );
  assert.match(
    MEMBERSHIP_BODY,
    /constraint vibode_afc_diagnostic_session_generations_generation_id_key\s+unique \(generation_id\)/,
  );
  assert.doesNotMatch(
    PRODUCTION_MIGRATION,
    /diagnostic_session_id/,
  );
  assert.doesNotMatch(MIGRATION, /alter table public\.vibode_afc_generations/);
});

test("7) attempt_ordinal is unique per session and positive", () => {
  assert.match(
    MEMBERSHIP_BODY,
    /constraint vibode_afc_diagnostic_session_generations_session_ordinal_key\s+unique \(session_id, attempt_ordinal\)/,
  );
  assert.match(
    MEMBERSHIP_BODY,
    /constraint vibode_afc_diagnostic_session_generations_ordinal_positive\s+check \(attempt_ordinal > 0\)/,
  );
});

test("8) membership intent is closed to the AFC production intent set", () => {
  const intents: readonly AfcGenerationIntent[] = AFC_DIAGNOSTIC_SESSION_INTENTS;
  assert.deepEqual([...intents], ["analyze", "run_again", "reread_perspective"]);
  assert.match(
    MEMBERSHIP_BODY,
    /constraint vibode_afc_diagnostic_session_generations_intent_closed\s+check \(intent in \('analyze', 'run_again', 'reread_perspective'\)\)/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /constraint vibode_afc_generations_intent_closed\s+check \(intent in \('analyze', 'run_again', 'reread_perspective'\)\)/,
  );
  assert.doesNotMatch(MEMBERSHIP_BODY, /status/);
});

test("9) membership UPDATE is rejected", () => {
  const body = functionBody(
    MIGRATION,
    "vibode_afc_diagnostic_session_generations_protect_membership",
  );
  assert.match(
    body,
    /raise exception 'AFC diagnostic session generation membership is immutable'/,
  );
  assert.doesNotMatch(body, /return new/);
  assert.match(
    MIGRATION,
    /create trigger vibode_afc_diagnostic_session_generations_protect_membership\s+before update on public\.vibode_afc_diagnostic_session_generations/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before update or delete on public\.vibode_afc_diagnostic_session_generations/,
  );
});

test("10) membership cascade deletion remains possible", () => {
  assert.match(
    MEMBERSHIP_BODY,
    /session_id uuid not null\s+references public\.vibode_afc_diagnostic_sessions\(id\) on delete cascade/,
  );
  assert.match(
    MEMBERSHIP_BODY,
    /generation_id uuid not null\s+references public\.vibode_afc_generations\(id\) on delete cascade/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before delete on public\.vibode_afc_diagnostic_session_generations/,
  );
});

test("11) reported_generation_id is NOT NULL", () => {
  assert.match(
    CASE_BODY,
    /reported_generation_id uuid not null\s+references public\.vibode_afc_generations\(id\) on delete cascade/,
  );
  assert.doesNotMatch(CASE_BODY, /reported_generation_id uuid null/);
});

test("12) issue_codes is a non-empty text array", () => {
  assert.match(CASE_BODY, /issue_codes text\[\] not null/);
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_issue_codes_nonempty\s+check \(cardinality\(issue_codes\) >= 1\)/,
  );
  assert.doesNotMatch(CASE_BODY, /perspective_off|wall_edges_unrecognized|scale_incorrect/);
});

test("13) case notes are at most 2000 characters", () => {
  assert.equal(AFC_DIAGNOSTIC_NOTES_MAX_CHARS, 2000);
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_notes_len\s+check \(notes is null or char_length\(notes\) <= 2000\)/,
  );
  assert.equal(isAfcDiagnosticNotes(null), true);
  assert.equal(isAfcDiagnosticNotes("x".repeat(2000)), true);
  assert.equal(isAfcDiagnosticNotes("x".repeat(2001)), false);
});

test("14) case trigger is a closed set", () => {
  assert.deepEqual(
    [...AFC_DIAGNOSTIC_CASE_TRIGGERS],
    ["repeated_unsuccessful", "manual_report", "admin_capture"],
  );
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_trigger_closed\s+check \("trigger" in \('repeated_unsuccessful', 'manual_report', 'admin_capture'\)\)/,
  );
});

test("15) machine status snapshot is a closed generation-status set", () => {
  const statuses: readonly AfcGenerationStatus[] = AFC_DIAGNOSTIC_MACHINE_STATUS_SNAPSHOTS;
  assert.deepEqual([...statuses], ["ready", "failed", "running"]);
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_machine_status_closed\s+check \(machine_status_snapshot in \('ready', 'failed', 'running'\)\)/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /constraint vibode_afc_generations_status_closed\s+check \(status in \('running', 'ready', 'failed'\)\)/,
  );
});

test("16) immutable case evidence updates are rejected", () => {
  const body = functionBody(MIGRATION, "vibode_afc_diagnostic_cases_protect_evidence");
  for (const field of [
    "id",
    "session_id",
    "room_id",
    "reporter_user_id",
    "reported_generation_id",
    "original_sha256",
    "original_identity",
    "taxonomy_version",
    "issue_codes",
    "notes",
    '"trigger"',
    "machine_status_snapshot",
    "submitted_at",
  ]) {
    assert.match(
      body,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(body, /raise exception 'AFC diagnostic case evidence is immutable'/);
  assert.equal(
    (AFC_DIAGNOSTIC_CASE_EVIDENCE_FIELDS as readonly string[]).includes("reviewStatus"),
    false,
  );
});

test("17) review-only case updates are allowed", () => {
  const body = functionBody(MIGRATION, "vibode_afc_diagnostic_cases_protect_evidence");
  assert.match(body, /return new;/);
  assert.doesNotMatch(body, /new\.review_status is distinct from old\.review_status/);
  assert.doesNotMatch(body, /new\.reviewer_user_id is distinct from old\.reviewer_user_id/);
  assert.doesNotMatch(body, /new\.review_notes is distinct from old\.review_notes/);
  assert.doesNotMatch(body, /new\.reviewed_at is distinct from old\.reviewed_at/);
  assert.deepEqual(
    [...AFC_DIAGNOSTIC_CASE_REVIEW_FIELDS],
    ["reviewStatus", "reviewerUserId", "reviewNotes", "reviewedAt"],
  );
  assert.match(
    MIGRATION,
    /create trigger vibode_afc_diagnostic_cases_protect_evidence\s+before update on public\.vibode_afc_diagnostic_cases/,
  );
});

test("18) review_status is closed to new/in_review/closed", () => {
  assert.deepEqual([...AFC_DIAGNOSTIC_REVIEW_STATUSES], ["new", "in_review", "closed"]);
  assert.equal(isAfcDiagnosticReviewStatus("promoted"), false);
  assert.match(CASE_BODY, /review_status text not null default 'new'/);
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_review_status_closed\s+check \(review_status in \('new', 'in_review', 'closed'\)\)/,
  );
  assert.doesNotMatch(CASE_BODY, /promoted/);
});

test("19) review_notes are at most 2000 characters", () => {
  assert.match(
    CASE_BODY,
    /constraint vibode_afc_diagnostic_cases_review_notes_len\s+check \(review_notes is null or char_length\(review_notes\) <= 2000\)/,
  );
});

test("20) case delete/cascade remains possible", () => {
  assert.match(
    CASE_BODY,
    /session_id uuid not null\s+references public\.vibode_afc_diagnostic_sessions\(id\) on delete cascade/,
  );
  assert.match(
    CASE_BODY,
    /room_id uuid not null\s+references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    CASE_BODY,
    /reporter_user_id uuid not null\s+references auth\.users\(id\) on delete cascade/,
  );
  assert.match(
    CASE_BODY,
    /reported_generation_id uuid not null\s+references public\.vibode_afc_generations\(id\) on delete cascade/,
  );
  assert.match(
    CASE_BODY,
    /reviewer_user_id uuid null\s+references auth\.users\(id\) on delete set null/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before delete on public\.vibode_afc_diagnostic_cases/,
  );
});

test("21) all three diagnostic tables enable RLS", () => {
  for (const table of [
    AFC_DIAGNOSTIC_SESSION_TABLE,
    AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
    AFC_DIAGNOSTIC_CASE_TABLE,
  ]) {
    assert.match(
      MIGRATION,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }
  assert.doesNotMatch(MIGRATION, /create policy/);
});

test("22) anon and authenticated have no diagnostic table grants", () => {
  assert.doesNotMatch(
    MIGRATION,
    /grant [^\n]* on table public\.vibode_afc_diagnostic_[^\n]*\n\s+to (anon|authenticated)/,
  );
  assert.doesNotMatch(MIGRATION, /to authenticated/);
  assert.doesNotMatch(MIGRATION, /to anon/);
});

test("23) service_role is the only granted diagnostic table role", () => {
  for (const table of [
    AFC_DIAGNOSTIC_SESSION_TABLE,
    AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
    AFC_DIAGNOSTIC_CASE_TABLE,
  ]) {
    assert.match(
      MIGRATION,
      new RegExp(
        `revoke all on table public\\.${table}\\s+from public, anon, authenticated`,
      ),
    );
    assert.match(
      MIGRATION,
      new RegExp(
        `grant select, insert, update, delete on table public\\.${table}\\s+to service_role`,
      ),
    );
  }
});

test("24) diagnostics schema does not copy AFC production geometry or authority", () => {
  const schema = withoutComments(
    `${SESSION_BODY}\n${MEMBERSHIP_BODY}\n${CASE_BODY}`,
  );
  for (const forbidden of [
    "production_authority",
    "frozen_camera",
    "camera",
    "floor",
    "walls",
    "collision",
    "metric",
    "empty_sha256",
    "tiled_sha256",
    "empty_storage",
    "tiled_storage",
    "diagnostic_payload",
    "engine_fingerprint",
    "parent_generation_id",
    "current_afc_generation_id",
    "receipt",
  ]) {
    assert.doesNotMatch(
      schema,
      new RegExp(`\\b${forbidden}\\b`),
      `diagnostics tables must not contain ${forbidden}`,
    );
  }
  assert.doesNotMatch(withoutComments(MIGRATION), /engine_fingerprint/);
});

test("25) AFC generation authority, parent lineage, and activation stay untouched", () => {
  assert.match(
    PRODUCTION_MIGRATION,
    /parent_generation_id uuid null references public\.vibode_afc_generations\(id\) on delete set null/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /create or replace function public\.activate_vibode_afc_generation/,
  );
  assert.match(
    PRODUCTION_MIGRATION,
    /create trigger vibode_afc_generations_protect_authority\s+before update on public\.vibode_afc_generations/,
  );
  assert.doesNotMatch(MIGRATION, /alter table public\.vibode_afc_generations/);
  assert.doesNotMatch(MIGRATION, /alter table public\.vibode_rooms/);
  assert.doesNotMatch(MIGRATION, /activate_vibode_afc_generation/);
  assert.doesNotMatch(MIGRATION, /vibode_afc_generations_protect_authority/);
  assert.doesNotMatch(MIGRATION, /parent_generation_id/);
  assert.doesNotMatch(MIGRATION, /current_afc_generation_id/);
  const persistence = source("lib/afc-v2-production/production-persistence.server.ts");
  assert.match(persistence, /parent_generation_id: input\.parentGenerationId/);
  assert.doesNotMatch(persistence, /afc-v2-diagnostics|vibode_afc_diagnostic_/);
});

test("26) production AFC core stays isolated from diagnostics except AFD-2B analyze attach", () => {
  const analyzeRoute = path.join(ROOT, "app/api/vibode/afc/analyze/route.ts");
  const files = [
    ...walkTs(path.join(ROOT, "app/api/vibode/afc")).filter(
      (file) =>
        !file.includes(`${path.sep}afc${path.sep}qa${path.sep}`) &&
        file !== analyzeRoute,
    ),
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
    ...walkTs(path.join(ROOT, "lib/afc-v2-runtime")),
  ];
  assert.equal(
    files.some((file) => file.endsWith("analyze/route.ts")),
    false,
  );
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(
      text,
      /afc-v2-diagnostics|vibode_afc_diagnostic_/,
      `${path.relative(ROOT, file)} must not import diagnostics`,
    );
  }
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  assert.match(
    analyze,
    /from "@\/lib\/afc-v2-diagnostics\/session-attach\.server"/,
  );
  assert.match(analyze, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(
    analyze,
    /session-lifecycle|ensureAfcDiagnosticSessionMembership|qa-capability|retry-episode-signal|getAfcDiagnosticRetryEpisodeSignal|vibode_afc_diagnostic_/,
  );
  const diagnosticsModule = [
    source("lib/afc-v2-diagnostics/index.ts"),
    source("lib/afc-v2-diagnostics/contracts.ts"),
    source("lib/afc-v2-diagnostics/taxonomy.ts"),
    source("lib/afc-v2-diagnostics/qa-capability.server.ts"),
    source("lib/afc-v2-diagnostics/session-lifecycle.server.ts"),
    source("lib/afc-v2-diagnostics/session-attach.server.ts"),
    source("lib/afc-v2-diagnostics/retry-episode-signal.server.ts"),
  ].join("\n");
  assert.doesNotMatch(
    diagnosticsModule,
    /runProductionAfcAnalysis|production-adapter|production-persistence|production-authority-contract/,
  );
});

test("27) taxonomy v1 accepts all four current codes", () => {
  const result = validateAfcQaIssueTaxonomy({
    version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    codes: [...AFC_QA_ISSUE_CODES],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual([...result.codes], [...AFC_QA_ISSUE_CODES]);
  }
  for (const code of AFC_QA_ISSUE_CODES) {
    assert.equal(isAfcQaIssueCode(code), true);
  }
});

test("28) taxonomy v1 accepts multiple codes", () => {
  const result = validateAfcQaIssueTaxonomy({
    version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    codes: ["perspective_off", "scale_incorrect"],
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual([...result.codes], ["perspective_off", "scale_incorrect"]);
  }
});

test("29) unknown v1 codes are rejected", () => {
  const result = validateAfcQaIssueTaxonomy({
    version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    codes: ["perspective_off", "not_a_code"],
  });
  assert.deepEqual(result, { ok: false, reason: "unknown_code" });
  assert.deepEqual(
    validateAfcQaIssueTaxonomy({
      version: AFC_QA_ISSUE_TAXONOMY_VERSION,
      codes: [],
    }),
    { ok: false, reason: "empty_codes" },
  );
  assert.deepEqual(
    validateAfcQaIssueTaxonomy({
      version: "afc-qa-issue-taxonomy/v2",
      codes: ["perspective_off"],
    }),
    { ok: false, reason: "unknown_taxonomy_version" },
  );
});

test("30) taxonomy labels are not persisted as machine identity", () => {
  assert.equal(AFC_QA_ISSUE_CODE_LABELS.perspective_off, "Perspective off");
  assert.equal(AFC_QA_ISSUE_CODE_LABELS.wall_edges_unrecognized, "Wall edges unrecognized");
  assert.equal(AFC_QA_ISSUE_CODE_LABELS.scale_incorrect, "Scale incorrect");
  assert.equal(AFC_QA_ISSUE_CODE_LABELS.other, "Other");
  for (const label of Object.values(AFC_QA_ISSUE_CODE_LABELS)) {
    assert.doesNotMatch(MIGRATION, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.notEqual(label, "perspective_off");
  }
  assert.doesNotMatch(MIGRATION, /perspective_off|wall_edges_unrecognized|scale_incorrect/);
  const labeled = validateAfcQaIssueTaxonomy({
    version: AFC_QA_ISSUE_TAXONOMY_VERSION,
    codes: ["other"],
  });
  assert.equal(labeled.ok, true);
  assert.equal("notes" in (labeled as object), false);
});

test("31) taxonomy version is exactly afc-qa-issue-taxonomy/v1", () => {
  assert.equal(AFC_QA_ISSUE_TAXONOMY_VERSION, "afc-qa-issue-taxonomy/v1");
  assert.doesNotMatch(MIGRATION, /afc-qa-issue-taxonomy\/v1/);
  assert.match(
    CASE_BODY,
    /taxonomy_version text not null/,
  );
  assert.doesNotMatch(
    CASE_BODY,
    /taxonomy_version[\s\S]{0,80}in \(/,
  );
});

test("32) session identity fields are protected from UPDATE", () => {
  const body = functionBody(
    MIGRATION,
    "vibode_afc_diagnostic_sessions_protect_identity",
  );
  for (const field of [
    "room_id",
    "user_id",
    "original_sha256",
    "base_asset_id",
    "created_at",
  ]) {
    assert.match(
      body,
      new RegExp(`new\\.${field} is distinct from old\\.${field}`),
    );
  }
  assert.match(body, /raise exception 'AFC diagnostic session identity is immutable'/);
  assert.match(
    MIGRATION,
    /create trigger vibode_afc_diagnostic_sessions_protect_identity\s+before update on public\.vibode_afc_diagnostic_sessions/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before update or delete on public\.vibode_afc_diagnostic_sessions/,
  );
});

test("33) session status remains mutable", () => {
  const body = functionBody(
    MIGRATION,
    "vibode_afc_diagnostic_sessions_protect_identity",
  );
  assert.match(body, /return new;/);
  assert.doesNotMatch(body, /new\.status is distinct from old\.status/);
  assert.match(
    SESSION_BODY,
    /constraint vibode_afc_diagnostic_sessions_status_closed\s+check \(status in \('open', 'closed'\)\)/,
  );
});

test("34) session updated_at remains compatible with set_timestamp", () => {
  const body = functionBody(
    MIGRATION,
    "vibode_afc_diagnostic_sessions_protect_identity",
  );
  assert.doesNotMatch(body, /new\.updated_at is distinct from old\.updated_at/);
  assert.doesNotMatch(body, /new\.updated_at\s*=/);
  assert.match(
    MIGRATION,
    /create trigger set_timestamp_vibode_afc_diagnostic_sessions\s+before update on public\.vibode_afc_diagnostic_sessions\s+for each row execute function public\.set_timestamp\(\)/,
  );
});

test("35) session DELETE/cascade semantics remain intact", () => {
  assert.match(
    SESSION_BODY,
    /room_id uuid not null references public\.vibode_rooms\(id\) on delete cascade/,
  );
  assert.match(
    SESSION_BODY,
    /user_id uuid not null references auth\.users\(id\) on delete cascade/,
  );
  assert.doesNotMatch(
    MIGRATION,
    /before delete on public\.vibode_afc_diagnostic_sessions/,
  );
});
