/**
 * AFD-4B admin Case inbox helpers.
 *
 * Browser-safe. Consumes the certified AFD-4A list DTO only.
 * Does not import Node-only cursor encoding helpers at runtime.
 */

import type { AfcDiagnosticAdminCaseSummary } from "./admin-read-model";
import {
  isAfcDiagnosticCaseTrigger,
  isAfcDiagnosticMachineStatusSnapshot,
  isAfcDiagnosticReviewStatus,
  isAfcDiagnosticSessionStatus,
  type AfcDiagnosticCaseTrigger,
  type AfcDiagnosticMachineStatusSnapshot,
  type AfcDiagnosticReviewStatus,
  type AfcDiagnosticSessionStatus,
} from "./contracts";
import {
  AFC_QA_TESTER_ISSUE_OPTIONS,
  canonicalAfcQaIssueCodes,
} from "./tester-report.client";
import { isAfcQaIssueCode } from "./taxonomy";

export type { AfcDiagnosticAdminCaseSummary };

export const AFC_DIAGNOSTIC_ADMIN_CASES_PATH =
  "/api/admin/afc-diagnostics/cases" as const;

export const AFC_DIAGNOSTIC_INBOX_PAGE_PATH =
  "/admin/afc-diagnostics" as const;

export const AFC_DIAGNOSTIC_INBOX_FILTER_KEYS = [
  "reviewStatus",
  "trigger",
  "issueCode",
  "machineStatusSnapshot",
  "roomId",
  "submittedFrom",
  "submittedTo",
] as const;

export type AfcDiagnosticInboxFilterKey =
  (typeof AFC_DIAGNOSTIC_INBOX_FILTER_KEYS)[number];

export type AfcDiagnosticInboxOrigin = "tester" | "admin";

export type AfcDiagnosticInboxCommittedFilters = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus | null;
  trigger: AfcDiagnosticCaseTrigger | null;
  issueCode: string | null;
  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot | null;
  roomId: string | null;
  submittedFrom: string | null;
  submittedTo: string | null;
}>;

export type AfcDiagnosticInboxListPayload = Readonly<{
  items: readonly AfcDiagnosticAdminCaseSummary[];
  nextCursor: string | null;
}>;

export type AfcDiagnosticInboxIssueChip = Readonly<{
  key: string;
  label: string;
  title: string;
}>;

export type AfcDiagnosticInboxIssueDisplay = Readonly<{
  chips: readonly AfcDiagnosticInboxIssueChip[];
  overflowCount: number;
  title: string;
}>;

export type AfcDiagnosticInboxDraftValidation =
  | {
      ok: true;
      roomId: string | null;
      submittedFrom: string | null;
      submittedTo: string | null;
    }
  | { ok: false; message: string };

export type AfcDiagnosticInboxFetchMode = "page1" | "refresh" | "more";

export type AfcDiagnosticInboxBeginRequest =
  | { started: false }
  | {
      started: true;
      seq: number;
      signal: AbortSignal;
      replaceItems: boolean;
    };

export const AFC_DIAGNOSTIC_INBOX_COPY = {
  title: "AFC Diagnostics",
  subtitle: "Review diagnostic cases, retry activity, and room-analysis reports.",
  loading: "Loading cases...",
  refreshing: "Refreshing...",
  loadMore: "Load more",
  loadMoreLoading: "Loading...",
  emptyUnfiltered: "No diagnostic cases yet.",
  emptyFiltered: "No cases match these filters.",
  error401: "Session expired. Sign in again.",
  error403: "Admin access required.",
  error400: "Those filters aren’t valid. Clear filters and try again.",
  errorGeneric: "Couldn’t load diagnostic cases. Try again.",
  invalidRoomId: "Enter a valid room ID.",
  invalidDateRange: "Submitted from must be before submitted to.",
  invalidDate: "Enter a valid submitted date.",
  unknownIssue: "Unknown issue",
  notes: "Notes",
  retry: "Retry",
  apply: "Apply",
  clearFilters: "Clear filters",
  showClosed: "Show closed",
  hideClosed: "Hide closed",
  refresh: "Refresh",
  backToAdmin: "Back to Admin",
  detailTitle: "Case detail",
  detailPlaceholder: "Full case inspection is not in this view yet.",
  backToDiagnostics: "Back to AFC Diagnostics",
} as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LOCAL_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const ORIGIN_SET = new Set<AfcDiagnosticInboxOrigin>(["tester", "admin"]);

const ISSUE_LABEL_BY_CODE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    AFC_QA_TESTER_ISSUE_OPTIONS.map((option) => [option.code, option.label]),
  ),
);

export const AFC_DIAGNOSTIC_INBOX_REVIEW_OPTIONS = [
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "closed", label: "Closed" },
] as const;

export const AFC_DIAGNOSTIC_INBOX_TRIGGER_OPTIONS = [
  { value: "manual_report", label: "Manual report" },
  { value: "repeated_unsuccessful", label: "Repeated unsuccessful" },
  { value: "admin_capture", label: "Capture" },
] as const;

export const AFC_DIAGNOSTIC_INBOX_MACHINE_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "ready", label: "Ready" },
  { value: "failed", label: "Failed" },
] as const;

export const AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS = AFC_QA_TESTER_ISSUE_OPTIONS;

const EMPTY_FILTERS: AfcDiagnosticInboxCommittedFilters = Object.freeze({
  reviewStatus: null,
  trigger: null,
  issueCode: null,
  machineStatusSnapshot: null,
  roomId: null,
  submittedFrom: null,
  submittedTo: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isOrigin(value: unknown): value is AfcDiagnosticInboxOrigin {
  return typeof value === "string" && ORIGIN_SET.has(value as AfcDiagnosticInboxOrigin);
}

function parseTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!Number.isFinite(Date.parse(trimmed))) return null;
  return trimmed;
}

export function parseAfcDiagnosticInboxUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function isAfcDiagnosticInboxUuid(value: unknown): boolean {
  return parseAfcDiagnosticInboxUuid(value) != null;
}

export function shortAfcDiagnosticUuid(id: string): string {
  return id.slice(0, 8);
}

export function afcDiagnosticInboxIssueLabel(code: string): {
  label: string;
  title: string;
} {
  const known = ISSUE_LABEL_BY_CODE[code];
  if (known) {
    return { label: known, title: known };
  }
  return {
    label: AFC_DIAGNOSTIC_INBOX_COPY.unknownIssue,
    title: code,
  };
}

export function orderedAfcDiagnosticInboxIssueCodes(
  codes: readonly string[],
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const code of canonicalAfcQaIssueCodes(codes)) {
    if (seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }
  for (const code of codes) {
    if (typeof code !== "string" || code.length === 0) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    ordered.push(code);
  }
  return ordered;
}

export function afcDiagnosticInboxIssueDisplay(
  codes: readonly string[],
): AfcDiagnosticInboxIssueDisplay {
  const ordered = orderedAfcDiagnosticInboxIssueCodes(codes);
  const labeled = ordered.map((code) => {
    const mapped = afcDiagnosticInboxIssueLabel(code);
    return {
      key: code,
      label: mapped.label,
      title: mapped.title,
    };
  });
  const title = labeled.map((entry) => entry.label).join(", ");
  return Object.freeze({
    chips: Object.freeze(labeled.slice(0, 2)),
    overflowCount: Math.max(0, labeled.length - 2),
    title,
  });
}

export function afcDiagnosticInboxReviewLabel(
  status: AfcDiagnosticReviewStatus | string,
): string {
  if (status === "new") return "New";
  if (status === "in_review") return "In review";
  if (status === "closed") return "Closed";
  return status;
}

export function afcDiagnosticInboxEffectiveShowClosed(
  showClosed: boolean,
  committedReviewStatus: AfcDiagnosticReviewStatus | null,
): boolean {
  return showClosed || committedReviewStatus === "closed";
}

export function afcDiagnosticInboxShowsClosedVisibilityToggle(
  committedReviewStatus: AfcDiagnosticReviewStatus | null,
): boolean {
  return committedReviewStatus !== "closed";
}

export function filterAfcDiagnosticCasesByClosedVisibility<
  T extends { readonly reviewStatus: string },
>(cases: readonly T[], showClosed: boolean): readonly T[] {
  if (showClosed) return cases;
  return cases.filter((item) => item.reviewStatus !== "closed");
}

export function countAfcDiagnosticInboxClosedCases(
  cases: readonly { readonly reviewStatus: string }[],
): number {
  let count = 0;
  for (const item of cases) {
    if (item.reviewStatus === "closed") count += 1;
  }
  return count;
}

export function afcDiagnosticInboxClosedVisibilityLabel(
  showClosed: boolean,
  closedCount = 0,
): string {
  if (showClosed) return AFC_DIAGNOSTIC_INBOX_COPY.hideClosed;
  if (closedCount > 0) {
    return `${AFC_DIAGNOSTIC_INBOX_COPY.showClosed} (${closedCount})`;
  }
  return AFC_DIAGNOSTIC_INBOX_COPY.showClosed;
}

export function afcDiagnosticInboxEmptyStateUsesFilterCopy(input: {
  hasCommittedFilters: boolean;
  showClosed: boolean;
  loadedCount: number;
  visibleCount: number;
}): boolean {
  if (input.visibleCount > 0) return false;
  if (input.hasCommittedFilters) return true;
  return !input.showClosed && input.loadedCount > 0;
}

export function afcDiagnosticInboxTriggerLabel(
  trigger: AfcDiagnosticCaseTrigger | string,
): string {
  if (trigger === "manual_report") return "Manual report";
  if (trigger === "repeated_unsuccessful") return "Repeated unsuccessful";
  if (trigger === "admin_capture") return "Capture";
  return trigger;
}

export function afcDiagnosticInboxOriginLabel(
  origin: AfcDiagnosticInboxOrigin | string,
): string {
  if (origin === "tester") return "Tester";
  if (origin === "admin") return "Admin";
  return origin;
}

export function afcDiagnosticInboxSourceText(
  origin: AfcDiagnosticInboxOrigin | string,
  trigger: AfcDiagnosticCaseTrigger | string,
): string {
  return `${afcDiagnosticInboxOriginLabel(origin)} · ${afcDiagnosticInboxTriggerLabel(trigger)}`;
}

export function afcDiagnosticInboxMachineLabel(
  status: AfcDiagnosticMachineStatusSnapshot | string,
): string {
  if (status === "running") return "Running";
  if (status === "ready") return "Ready";
  if (status === "failed") return "Failed";
  return status;
}

export function afcDiagnosticInboxSessionStatusLabel(
  status: AfcDiagnosticSessionStatus | string,
): string {
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
}

export function afcDiagnosticInboxAttemptLabel(count: number): string {
  return count === 1 ? "1 attempt" : `${count} attempts`;
}

export function formatAfcDiagnosticInboxSubmittedAt(submittedAt: string): {
  display: string;
  title: string;
} {
  const title = submittedAt;
  const ms = Date.parse(submittedAt);
  if (!Number.isFinite(ms)) {
    return { display: "—", title };
  }
  return {
    display: new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }),
    title,
  };
}

export function parseLocalDateOnlyInput(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = LOCAL_DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

export function localDateInputToIsoStart(dateOnly: string): string | null {
  const parts = parseLocalDateOnlyInput(dateOnly);
  if (!parts) return null;
  return new Date(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0).toISOString();
}

export function localDateInputToIsoEnd(dateOnly: string): string | null {
  const parts = parseLocalDateOnlyInput(dateOnly);
  if (!parts) return null;
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    23,
    59,
    59,
    999,
  ).toISOString();
}

export function isoTimestampToLocalDateInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function emptyAfcDiagnosticInboxCommittedFilters(): AfcDiagnosticInboxCommittedFilters {
  return EMPTY_FILTERS;
}

export function afcDiagnosticInboxHasCommittedFilters(
  filters: AfcDiagnosticInboxCommittedFilters,
): boolean {
  return AFC_DIAGNOSTIC_INBOX_FILTER_KEYS.some((key) => filters[key] != null);
}

export function parseAfcDiagnosticInboxCommittedFilters(
  searchParams: { get(name: string): string | null },
): AfcDiagnosticInboxCommittedFilters {
  const reviewRaw = searchParams.get("reviewStatus")?.trim() ?? "";
  const reviewStatus = isAfcDiagnosticReviewStatus(reviewRaw) ? reviewRaw : null;

  const triggerRaw = searchParams.get("trigger")?.trim() ?? "";
  const trigger = isAfcDiagnosticCaseTrigger(triggerRaw) ? triggerRaw : null;

  const issueRaw = searchParams.get("issueCode")?.trim() ?? "";
  const issueCode = isAfcQaIssueCode(issueRaw) ? issueRaw : null;

  const machineRaw = searchParams.get("machineStatusSnapshot")?.trim() ?? "";
  const machineStatusSnapshot = isAfcDiagnosticMachineStatusSnapshot(machineRaw)
    ? machineRaw
    : null;

  const roomId = parseAfcDiagnosticInboxUuid(searchParams.get("roomId") ?? "");

  const submittedFromRaw = searchParams.get("submittedFrom");
  const submittedFrom =
    submittedFromRaw && submittedFromRaw.trim().length > 0
      ? parseTimestamp(submittedFromRaw)
      : null;

  const submittedToRaw = searchParams.get("submittedTo");
  const submittedTo =
    submittedToRaw && submittedToRaw.trim().length > 0
      ? parseTimestamp(submittedToRaw)
      : null;

  return Object.freeze({
    reviewStatus,
    trigger,
    issueCode,
    machineStatusSnapshot,
    roomId,
    submittedFrom,
    submittedTo,
  });
}

export function serializeAfcDiagnosticInboxCommittedFilters(
  filters: AfcDiagnosticInboxCommittedFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.reviewStatus) params.set("reviewStatus", filters.reviewStatus);
  if (filters.trigger) params.set("trigger", filters.trigger);
  if (filters.issueCode) params.set("issueCode", filters.issueCode);
  if (filters.machineStatusSnapshot) {
    params.set("machineStatusSnapshot", filters.machineStatusSnapshot);
  }
  if (filters.roomId) params.set("roomId", filters.roomId);
  if (filters.submittedFrom) params.set("submittedFrom", filters.submittedFrom);
  if (filters.submittedTo) params.set("submittedTo", filters.submittedTo);
  return params;
}

export function applyAfcDiagnosticInboxSelectFilter(
  filters: AfcDiagnosticInboxCommittedFilters,
  key: "reviewStatus" | "trigger" | "issueCode" | "machineStatusSnapshot",
  value: string,
): AfcDiagnosticInboxCommittedFilters {
  if (key === "reviewStatus") {
    return Object.freeze({
      ...filters,
      reviewStatus: isAfcDiagnosticReviewStatus(value) ? value : null,
    });
  }
  if (key === "trigger") {
    return Object.freeze({
      ...filters,
      trigger: isAfcDiagnosticCaseTrigger(value) ? value : null,
    });
  }
  if (key === "issueCode") {
    return Object.freeze({
      ...filters,
      issueCode: isAfcQaIssueCode(value) ? value : null,
    });
  }
  return Object.freeze({
    ...filters,
    machineStatusSnapshot: isAfcDiagnosticMachineStatusSnapshot(value)
      ? value
      : null,
  });
}

export function buildAfcDiagnosticInboxPageHref(
  filters: AfcDiagnosticInboxCommittedFilters,
): string {
  const query = serializeAfcDiagnosticInboxCommittedFilters(filters).toString();
  return query
    ? `${AFC_DIAGNOSTIC_INBOX_PAGE_PATH}?${query}`
    : AFC_DIAGNOSTIC_INBOX_PAGE_PATH;
}

export function buildAfcDiagnosticInboxListUrl(
  filters: AfcDiagnosticInboxCommittedFilters,
  cursor?: string | null,
): string {
  const params = serializeAfcDiagnosticInboxCommittedFilters(filters);
  if (typeof cursor === "string" && cursor.length > 0) {
    params.set("cursor", cursor);
  }
  const query = params.toString();
  return query
    ? `${AFC_DIAGNOSTIC_ADMIN_CASES_PATH}?${query}`
    : AFC_DIAGNOSTIC_ADMIN_CASES_PATH;
}

export function validateAfcDiagnosticInboxDraftFilters(input: {
  roomId: string;
  submittedFrom: string;
  submittedTo: string;
}): AfcDiagnosticInboxDraftValidation {
  const roomRaw = input.roomId.trim();
  let roomId: string | null = null;
  if (roomRaw.length > 0) {
    roomId = parseAfcDiagnosticInboxUuid(roomRaw);
    if (!roomId) {
      return { ok: false, message: AFC_DIAGNOSTIC_INBOX_COPY.invalidRoomId };
    }
  }

  const fromRaw = input.submittedFrom.trim();
  const toRaw = input.submittedTo.trim();
  let submittedFrom: string | null = null;
  let submittedTo: string | null = null;

  if (fromRaw.length > 0) {
    submittedFrom = localDateInputToIsoStart(fromRaw);
    if (!submittedFrom) {
      return { ok: false, message: AFC_DIAGNOSTIC_INBOX_COPY.invalidDate };
    }
  }
  if (toRaw.length > 0) {
    submittedTo = localDateInputToIsoEnd(toRaw);
    if (!submittedTo) {
      return { ok: false, message: AFC_DIAGNOSTIC_INBOX_COPY.invalidDate };
    }
  }

  if (fromRaw.length > 0 && toRaw.length > 0) {
    const fromParts = parseLocalDateOnlyInput(fromRaw);
    const toParts = parseLocalDateOnlyInput(toRaw);
    if (
      fromParts &&
      toParts &&
      new Date(fromParts.year, fromParts.month - 1, fromParts.day).getTime() >
        new Date(toParts.year, toParts.month - 1, toParts.day).getTime()
    ) {
      return { ok: false, message: AFC_DIAGNOSTIC_INBOX_COPY.invalidDateRange };
    }
  }

  return {
    ok: true,
    roomId,
    submittedFrom,
    submittedTo,
  };
}

function parseIssueCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    codes.push(entry);
  }
  return codes;
}

function parseCaseSummary(value: unknown): AfcDiagnosticAdminCaseSummary | null {
  if (!isRecord(value)) return null;
  const caseId = parseAfcDiagnosticInboxUuid(value.caseId);
  if (!caseId) return null;
  if (typeof value.submittedAt !== "string") return null;
  if (!isAfcDiagnosticReviewStatus(value.reviewStatus)) return null;
  if (!isAfcDiagnosticCaseTrigger(value.trigger)) return null;
  if (!isOrigin(value.origin)) return null;
  const issueCodes = parseIssueCodes(value.issueCodes);
  if (!issueCodes) return null;
  if (typeof value.taxonomyVersion !== "string") return null;
  if (typeof value.hasNotes !== "boolean") return null;
  const roomId = parseAfcDiagnosticInboxUuid(value.roomId);
  if (!roomId) return null;
  const sessionId = parseAfcDiagnosticInboxUuid(value.sessionId);
  if (!sessionId) return null;
  if (!isAfcDiagnosticSessionStatus(value.sessionStatus)) return null;
  if (
    typeof value.sessionAttemptCount !== "number" ||
    !Number.isInteger(value.sessionAttemptCount) ||
    value.sessionAttemptCount < 0
  ) {
    return null;
  }
  const reportedGenerationId = parseAfcDiagnosticInboxUuid(
    value.reportedGenerationId,
  );
  if (!reportedGenerationId) return null;
  if (!isAfcDiagnosticMachineStatusSnapshot(value.machineStatusSnapshot)) {
    return null;
  }
  const reporterUserId = parseAfcDiagnosticInboxUuid(value.reporterUserId);
  if (!reporterUserId) return null;
  return Object.freeze({
    caseId,
    submittedAt: value.submittedAt,
    reviewStatus: value.reviewStatus,
    trigger: value.trigger,
    origin: value.origin,
    issueCodes: Object.freeze(issueCodes),
    taxonomyVersion: value.taxonomyVersion,
    hasNotes: value.hasNotes,
    roomId,
    sessionId,
    sessionStatus: value.sessionStatus,
    sessionAttemptCount: value.sessionAttemptCount,
    reportedGenerationId,
    machineStatusSnapshot: value.machineStatusSnapshot,
    reporterUserId,
  });
}

export function parseAfcDiagnosticInboxListPayload(
  value: unknown,
): AfcDiagnosticInboxListPayload | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.items)) return null;
  if (value.nextCursor !== null && typeof value.nextCursor !== "string") {
    return null;
  }
  const items: AfcDiagnosticAdminCaseSummary[] = [];
  for (const entry of value.items) {
    const item = parseCaseSummary(entry);
    if (!item) return null;
    items.push(item);
  }
  const nextCursor =
    typeof value.nextCursor === "string" && value.nextCursor.length > 0
      ? value.nextCursor
      : null;
  return Object.freeze({
    items: Object.freeze(items),
    nextCursor,
  });
}

export function mergeAfcDiagnosticInboxItems(
  existing: readonly AfcDiagnosticAdminCaseSummary[],
  incoming: readonly AfcDiagnosticAdminCaseSummary[],
): AfcDiagnosticAdminCaseSummary[] {
  const seen = new Set(existing.map((item) => item.caseId));
  const merged = [...existing];
  for (const item of incoming) {
    if (seen.has(item.caseId)) continue;
    seen.add(item.caseId);
    merged.push(item);
  }
  return merged;
}

export function afcDiagnosticInboxLoadErrorMessage(
  status: number | "network",
): string {
  if (status === 401) return AFC_DIAGNOSTIC_INBOX_COPY.error401;
  if (status === 403) return AFC_DIAGNOSTIC_INBOX_COPY.error403;
  if (status === 400) return AFC_DIAGNOSTIC_INBOX_COPY.error400;
  return AFC_DIAGNOSTIC_INBOX_COPY.errorGeneric;
}

export function isAfcDiagnosticInboxAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

export function createAfcDiagnosticInboxRequestCoordinator() {
  let latestSeq = 0;
  let controller: AbortController | null = null;
  let active = false;

  return {
    begin(
      mode: AfcDiagnosticInboxFetchMode,
      requestActive = active,
    ): AfcDiagnosticInboxBeginRequest {
      if (mode === "more" && requestActive) {
        return { started: false };
      }
      if (mode !== "more") {
        controller?.abort();
      }
      latestSeq += 1;
      controller = new AbortController();
      active = true;
      return {
        started: true,
        seq: latestSeq,
        signal: controller.signal,
        replaceItems: mode !== "more",
      };
    },
    isCurrent(seq: number): boolean {
      return seq === latestSeq;
    },
    finish(seq: number): void {
      if (seq === latestSeq) {
        active = false;
      }
    },
    isActive(): boolean {
      return active;
    },
  };
}

export function shouldCommitAfcDiagnosticInboxRequest(
  latestSeq: number,
  responseSeq: number,
): boolean {
  return latestSeq === responseSeq;
}
