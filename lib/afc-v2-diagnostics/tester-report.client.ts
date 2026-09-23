/**
 * AFD-3C tester-report client helpers.
 *
 * Consumes the frozen AFD-3B projection and AFD-3A Case POST contract.
 * Does not invent eligibility, Session lifecycle, or AFC authority.
 */

import { AFC_DIAGNOSTIC_NOTES_MAX_CHARS } from "./contracts";
import {
  AFC_QA_ISSUE_CODES,
  isAfcQaIssueCode,
  type AfcQaIssueCode,
} from "./taxonomy";

export type { AfcQaIssueCode };

export const AFC_QA_BROWSER_STATE_PATH = "/api/vibode/afc/qa/state";
export const AFC_QA_TESTER_CASE_PATH = "/api/vibode/afc/qa/cases";
export const AFC_QA_READY_RERUN_PATH = "/api/vibode/afc/qa/rerun";

export type AfcQaTesterTrigger = "manual_report" | "repeated_unsuccessful";

export type AfcQaBrowserState = {
  enabled: boolean;
  canReport: boolean;
  offerFeedback: boolean;
  reportGenerationId: string | null;
};

export const AFC_QA_TESTER_ISSUE_OPTIONS = [
  { code: "perspective_off", label: "Perspective looks wrong" },
  {
    code: "wall_edges_unrecognized",
    label: "Wall edges aren’t being recognized",
  },
  { code: "scale_incorrect", label: "Scale looks incorrect" },
  { code: "other", label: "Other" },
] as const satisfies ReadonlyArray<{
  code: AfcQaIssueCode;
  label: string;
}>;

export const AFC_QA_TESTER_COPY = {
  manualButton: "Report an issue",
  promptTitle: "Still not looking right?",
  promptBody: "Help us improve room reading by telling us what looks off.",
  promptReport: "Report an issue",
  promptDismiss: "Not now",
  notesLabel: "Additional notes",
  notesPlaceholder: "Tell us anything else that looks off...",
  submit: "Submit feedback",
  cancel: "Cancel",
  success: "Thanks — your feedback was submitted.",
  error400: "Please select at least one issue and check your feedback.",
  error404: "This room read is no longer available to report.",
  error500: "We couldn’t submit your feedback. Please try again.",
  sessionExpired: "Your session expired. Sign in again.",
  rerunButton: "Re-run room read",
  rerunError400:
    "Couldn’t re-run the room read. Please refresh and try again.",
  rerunError404: "This room read is no longer available to re-run.",
  rerunError500: "We couldn’t re-run the room read. Please try again.",
} as const;

export const AFC_QA_TESTER_NOTES_MAX_CHARS = AFC_DIAGNOSTIC_NOTES_MAX_CHARS;

export type AfcQaTesterCaseBody = Readonly<{
  roomId: string;
  generationId: string;
  issueCodes: readonly AfcQaIssueCode[];
  trigger: AfcQaTesterTrigger;
  notes?: string;
}>;

export type AfcQaTesterFormState = {
  trigger: AfcQaTesterTrigger;
  boundRoomId: string;
  boundGenerationId: string;
  selectedCodes: readonly AfcQaIssueCode[];
  notes: string;
  submitting: boolean;
  errorMessage: string | null;
};

export type AfcQaTesterReportModel = {
  roomId: string | null;
  projection: AfcQaBrowserState | null;
  loadStatus: "idle" | "loading" | "ready" | "error";
  dismissedGenerationId: string | null;
  submittedGenerationIds: readonly string[];
  form: AfcQaTesterFormState | null;
  successMessage: string | null;
  noticeMessage: string | null;
  rerunPending: boolean;
  rerunBoundGenerationId: string | null;
};

export type AfcQaTesterReportEvent =
  | { type: "room_changed"; roomId: string | null }
  | { type: "projection_loading" }
  | { type: "projection_ready"; projection: AfcQaBrowserState }
  | { type: "projection_error" }
  | { type: "open_manual" }
  | { type: "open_automatic" }
  | { type: "dismiss_automatic" }
  | { type: "cancel_form" }
  | { type: "toggle_issue"; code: AfcQaIssueCode }
  | { type: "set_notes"; notes: string }
  | { type: "submit_requested" }
  | { type: "submit_succeeded" }
  | { type: "submit_http_error"; status: number }
  | { type: "clear_success" }
  | {
      type: "rerun_requested";
      preparePhase: string | null;
      prepareGenerationId: string | null;
    }
  | { type: "rerun_succeeded" }
  | { type: "rerun_http_error"; status: number }
  | { type: "rerun_aborted" };

export type AfcQaReadyRerunBody = Readonly<{
  roomId: string;
  generationId: string;
}>;

export type AfcQaTesterReportEffect =
  | { type: "none" }
  | { type: "post_case"; url: string; body: AfcQaTesterCaseBody }
  | {
      type: "post_rerun";
      url: string;
      body: AfcQaReadyRerunBody;
    }
  | { type: "refresh_qa" }
  | { type: "unauthorized" };

export type AfcQaTesterReportViewContext = {
  preparePhase?: string | null;
  prepareGenerationId?: string | null;
};

export type AfcQaTesterReportViewModel = {
  showManualReport: boolean;
  showAutomaticPrompt: boolean;
  showForm: boolean;
  showRerun: boolean;
  rerunDisabled: boolean;
  submitting: boolean;
  canSubmit: boolean;
  successMessage: string | null;
  formError: string | null;
  noticeMessage: string | null;
  notes: string;
  notesMaxChars: number;
  selectedCodes: readonly AfcQaIssueCode[];
};

const FORBIDDEN_CASE_BODY_KEYS = [
  "sessionId",
  "session_id",
  "reporterUserId",
  "reporter_user_id",
  "taxonomyVersion",
  "taxonomy_version",
  "machineStatusSnapshot",
  "machine_status_snapshot",
  "originalSha256",
  "original_sha256",
  "originalIdentity",
  "original_identity",
  "reviewStatus",
  "review_status",
  "reviewerUserId",
  "reviewer_user_id",
  "reviewNotes",
  "review_notes",
  "reviewedAt",
  "reviewed_at",
  "caseId",
  "case_id",
  "attemptCount",
  "attempt_count",
  "engineFingerprint",
  "engine_fingerprint",
  "originalSha",
] as const;

const FORBIDDEN_RERUN_BODY_KEYS = [
  ...FORBIDDEN_CASE_BODY_KEYS,
  "intent",
  "userId",
  "user_id",
  "machineStatus",
  "machine_status",
  "status",
  "parentGenerationId",
  "parent_generation_id",
  "lineageSeq",
  "lineage_seq",
  "sourceIdentity",
] as const;

const NONE: AfcQaTesterReportEffect = { type: "none" };

export function afcQaBrowserStateUrl(roomId: string): string {
  return `${AFC_QA_BROWSER_STATE_PATH}?roomId=${encodeURIComponent(roomId)}`;
}

export function parseAfcQaBrowserState(
  payload: unknown,
): AfcQaBrowserState | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") return null;
  if (typeof record.canReport !== "boolean") return null;
  if (typeof record.offerFeedback !== "boolean") return null;
  if (record.reportGenerationId !== null && typeof record.reportGenerationId !== "string") {
    return null;
  }
  if (
    typeof record.reportGenerationId === "string" &&
    record.reportGenerationId.trim().length === 0
  ) {
    return null;
  }
  return {
    enabled: record.enabled,
    canReport: record.canReport,
    offerFeedback: record.offerFeedback,
    reportGenerationId: record.reportGenerationId,
  };
}

export function canonicalAfcQaIssueCodes(
  codes: readonly string[],
): AfcQaIssueCode[] {
  const selected = new Set(codes.filter(isAfcQaIssueCode));
  return AFC_QA_ISSUE_CODES.filter((code) => selected.has(code));
}

export function buildAfcQaTesterCaseBody(input: {
  roomId: string;
  generationId: string;
  issueCodes: readonly string[];
  trigger: AfcQaTesterTrigger;
  notes?: string | null;
}): AfcQaTesterCaseBody {
  const notes =
    typeof input.notes === "string" ? input.notes.trim().slice(0, AFC_QA_TESTER_NOTES_MAX_CHARS) : "";
  const body: {
    roomId: string;
    generationId: string;
    issueCodes: readonly AfcQaIssueCode[];
    trigger: AfcQaTesterTrigger;
    notes?: string;
  } = {
    roomId: input.roomId,
    generationId: input.generationId,
    issueCodes: canonicalAfcQaIssueCodes(input.issueCodes),
    trigger: input.trigger,
  };
  if (notes.length > 0) body.notes = notes;
  return Object.freeze(body);
}

export function collectAfcQaTesterCaseBodyPrivacyViolations(
  body: unknown,
): readonly string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Object.freeze(["invalid_body"]);
  }
  const record = body as Record<string, unknown>;
  const found: string[] = [];
  for (const key of FORBIDDEN_CASE_BODY_KEYS) {
    if (key in record) found.push(key);
  }
  return Object.freeze(found);
}

export function afcQaTesterSubmitErrorMessage(status: number): string {
  if (status === 400) return AFC_QA_TESTER_COPY.error400;
  if (status === 401) return AFC_QA_TESTER_COPY.sessionExpired;
  if (status === 404) return AFC_QA_TESTER_COPY.error404;
  return AFC_QA_TESTER_COPY.error500;
}

export function shouldRefreshAfcQaStateAfterPrepareSettle(input: {
  previousPhase: string | null;
  nextPhase: string | null;
}): boolean {
  return (
    input.previousPhase === "running" &&
    input.nextPhase !== "running" &&
    input.nextPhase != null &&
    input.nextPhase !== ""
  );
}

export function canShowAfcQaManualReport(
  projection: AfcQaBrowserState | null,
): boolean {
  return Boolean(
    projection?.enabled &&
      projection.canReport &&
      projection.reportGenerationId,
  );
}

export function canShowAfcQaAutomaticOffer(
  projection: AfcQaBrowserState | null,
): boolean {
  return Boolean(
    canShowAfcQaManualReport(projection) && projection?.offerFeedback,
  );
}

export function canShowAfcQaReadyRerun(input: {
  projection: AfcQaBrowserState | null;
  preparePhase: string | null | undefined;
  prepareGenerationId: string | null | undefined;
}): boolean {
  const generationId = input.projection?.reportGenerationId;
  if (!canShowAfcQaManualReport(input.projection) || !generationId) {
    return false;
  }
  if (input.preparePhase !== "ready") return false;
  if (
    typeof input.prepareGenerationId !== "string" ||
    input.prepareGenerationId.length === 0
  ) {
    return false;
  }
  return input.prepareGenerationId === generationId;
}

export function buildAfcQaReadyRerunBody(input: {
  roomId: string;
  generationId: string;
}): AfcQaReadyRerunBody {
  return Object.freeze({
    roomId: input.roomId,
    generationId: input.generationId,
  });
}

export function collectAfcQaReadyRerunBodyPrivacyViolations(
  body: unknown,
): readonly string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Object.freeze(["invalid_body"]);
  }
  const record = body as Record<string, unknown>;
  const found: string[] = [];
  for (const key of Object.keys(record)) {
    if (key !== "roomId" && key !== "generationId") found.push(key);
  }
  for (const key of FORBIDDEN_RERUN_BODY_KEYS) {
    if (key in record && !found.includes(key)) found.push(key);
  }
  return Object.freeze(found);
}

export function afcQaReadyRerunErrorMessage(status: number): string {
  if (status === 400) return AFC_QA_TESTER_COPY.rerunError400;
  if (status === 401) return AFC_QA_TESTER_COPY.sessionExpired;
  if (status === 404) return AFC_QA_TESTER_COPY.rerunError404;
  return AFC_QA_TESTER_COPY.rerunError500;
}

export function createInitialAfcQaTesterReportModel(
  roomId: string | null = null,
): AfcQaTesterReportModel {
  return {
    roomId,
    projection: null,
    loadStatus: roomId ? "loading" : "idle",
    dismissedGenerationId: null,
    submittedGenerationIds: [],
    form: null,
    successMessage: null,
    noticeMessage: null,
    rerunPending: false,
    rerunBoundGenerationId: null,
  };
}

function isPromptSuppressed(
  model: AfcQaTesterReportModel,
  generationId: string | null,
): boolean {
  if (!generationId) return true;
  if (model.dismissedGenerationId === generationId) return true;
  return model.submittedGenerationIds.includes(generationId);
}

function reportableGenerationId(
  projection: AfcQaBrowserState | null,
): string | null {
  if (!canShowAfcQaManualReport(projection)) return null;
  return projection?.reportGenerationId ?? null;
}

function formStillMatchesProjection(model: AfcQaTesterReportModel): boolean {
  const form = model.form;
  if (!form) return false;
  return (
    form.boundRoomId === model.roomId &&
    form.boundGenerationId === reportableGenerationId(model.projection)
  );
}

function closeStaleForm(model: AfcQaTesterReportModel): AfcQaTesterReportModel {
  if (!model.form) return model;
  if (formStillMatchesProjection(model)) return model;
  return {
    ...model,
    form: null,
  };
}

function openForm(
  model: AfcQaTesterReportModel,
  trigger: AfcQaTesterTrigger,
): AfcQaTesterReportModel {
  const generationId = reportableGenerationId(model.projection);
  if (!model.roomId || !generationId) return model;
  if (model.form?.submitting) return model;
  return {
    ...model,
    form: {
      trigger,
      boundRoomId: model.roomId,
      boundGenerationId: generationId,
      selectedCodes: [],
      notes: "",
      submitting: false,
      errorMessage: null,
    },
    noticeMessage: null,
    successMessage: null,
  };
}

export function deriveAfcQaTesterReportView(
  model: AfcQaTesterReportModel,
  context: AfcQaTesterReportViewContext = {},
): AfcQaTesterReportViewModel {
  const generationId = reportableGenerationId(model.projection);
  const showManualReport = generationId != null;
  const showAutomaticPrompt =
    showManualReport &&
    canShowAfcQaAutomaticOffer(model.projection) &&
    !isPromptSuppressed(model, generationId) &&
    model.form == null;
  const selectedCodes = model.form?.selectedCodes ?? [];
  const submitting = Boolean(model.form?.submitting);
  const showRerun = canShowAfcQaReadyRerun({
    projection: model.projection,
    preparePhase: context.preparePhase,
    prepareGenerationId: context.prepareGenerationId,
  });
  return {
    showManualReport,
    showAutomaticPrompt,
    showForm: model.form != null,
    showRerun,
    rerunDisabled: model.rerunPending || submitting,
    submitting,
    canSubmit: Boolean(model.form && selectedCodes.length > 0 && !submitting),
    successMessage: model.successMessage,
    formError: model.form?.errorMessage ?? null,
    noticeMessage: model.noticeMessage,
    notes: model.form?.notes ?? "",
    notesMaxChars: AFC_QA_TESTER_NOTES_MAX_CHARS,
    selectedCodes,
  };
}

export function reduceAfcQaTesterReport(
  model: AfcQaTesterReportModel,
  event: AfcQaTesterReportEvent,
): { state: AfcQaTesterReportModel; effect: AfcQaTesterReportEffect } {
  switch (event.type) {
    case "room_changed": {
      if (event.roomId === model.roomId) {
        return { state: model, effect: NONE };
      }
      return {
        state: createInitialAfcQaTesterReportModel(event.roomId),
        effect: NONE,
      };
    }
    case "projection_loading": {
      return {
        state: {
          ...model,
          loadStatus: model.projection ? model.loadStatus : "loading",
        },
        effect: NONE,
      };
    }
    case "projection_ready": {
      const next = closeStaleForm({
        ...model,
        projection: event.projection,
        loadStatus: "ready",
      });
      return { state: next, effect: NONE };
    }
    case "projection_error": {
      return {
        state: {
          ...model,
          projection: null,
          loadStatus: "error",
          form: null,
        },
        effect: NONE,
      };
    }
    case "open_manual": {
      if (!canShowAfcQaManualReport(model.projection)) {
        return { state: model, effect: NONE };
      }
      return { state: openForm(model, "manual_report"), effect: NONE };
    }
    case "open_automatic": {
      const generationId = reportableGenerationId(model.projection);
      if (
        !canShowAfcQaAutomaticOffer(model.projection) ||
        isPromptSuppressed(model, generationId)
      ) {
        return { state: model, effect: NONE };
      }
      return { state: openForm(model, "repeated_unsuccessful"), effect: NONE };
    }
    case "dismiss_automatic": {
      const generationId = reportableGenerationId(model.projection);
      if (!generationId || !canShowAfcQaAutomaticOffer(model.projection)) {
        return { state: model, effect: NONE };
      }
      return {
        state: {
          ...model,
          dismissedGenerationId: generationId,
        },
        effect: NONE,
      };
    }
    case "cancel_form": {
      if (!model.form || model.form.submitting) {
        return { state: model, effect: NONE };
      }
      return {
        state: { ...model, form: null },
        effect: NONE,
      };
    }
    case "toggle_issue": {
      if (!model.form || model.form.submitting) {
        return { state: model, effect: NONE };
      }
      if (!isAfcQaIssueCode(event.code)) {
        return { state: model, effect: NONE };
      }
      const exists = model.form.selectedCodes.includes(event.code);
      const selectedCodes = exists
        ? model.form.selectedCodes.filter((code) => code !== event.code)
        : canonicalAfcQaIssueCodes([...model.form.selectedCodes, event.code]);
      return {
        state: {
          ...model,
          form: {
            ...model.form,
            selectedCodes,
            errorMessage: null,
          },
        },
        effect: NONE,
      };
    }
    case "set_notes": {
      if (!model.form || model.form.submitting) {
        return { state: model, effect: NONE };
      }
      return {
        state: {
          ...model,
          form: {
            ...model.form,
            notes: event.notes.slice(0, AFC_QA_TESTER_NOTES_MAX_CHARS),
          },
        },
        effect: NONE,
      };
    }
    case "submit_requested": {
      if (!model.form) return { state: model, effect: NONE };
      if (model.form.submitting) return { state: model, effect: NONE };
      if (model.form.selectedCodes.length === 0) {
        return {
          state: {
            ...model,
            form: {
              ...model.form,
              errorMessage: AFC_QA_TESTER_COPY.error400,
            },
          },
          effect: NONE,
        };
      }
      if (!formStillMatchesProjection(model)) {
        return {
          state: {
            ...model,
            form: null,
            noticeMessage: AFC_QA_TESTER_COPY.error404,
          },
          effect: { type: "refresh_qa" },
        };
      }
      const body = buildAfcQaTesterCaseBody({
        roomId: model.form.boundRoomId,
        generationId: model.form.boundGenerationId,
        issueCodes: model.form.selectedCodes,
        trigger: model.form.trigger,
        notes: model.form.notes,
      });
      return {
        state: {
          ...model,
          form: {
            ...model.form,
            submitting: true,
            errorMessage: null,
          },
          noticeMessage: null,
        },
        effect: {
          type: "post_case",
          url: AFC_QA_TESTER_CASE_PATH,
          body,
        },
      };
    }
    case "submit_succeeded": {
      const generationId = model.form?.boundGenerationId;
      const submittedGenerationIds =
        generationId && !model.submittedGenerationIds.includes(generationId)
          ? [...model.submittedGenerationIds, generationId]
          : model.submittedGenerationIds;
      return {
        state: {
          ...model,
          form: null,
          submittedGenerationIds,
          dismissedGenerationId: generationId ?? model.dismissedGenerationId,
          successMessage: AFC_QA_TESTER_COPY.success,
          noticeMessage: null,
        },
        effect: { type: "refresh_qa" },
      };
    }
    case "submit_http_error": {
      if (!model.form) {
        if (event.status === 401) {
          return { state: model, effect: { type: "unauthorized" } };
        }
        return { state: model, effect: NONE };
      }
      if (event.status === 401) {
        return {
          state: {
            ...model,
            form: {
              ...model.form,
              submitting: false,
              errorMessage: AFC_QA_TESTER_COPY.sessionExpired,
            },
          },
          effect: { type: "unauthorized" },
        };
      }
      if (event.status === 404) {
        return {
          state: {
            ...model,
            form: null,
            noticeMessage: AFC_QA_TESTER_COPY.error404,
          },
          effect: { type: "refresh_qa" },
        };
      }
      return {
        state: {
          ...model,
          form: {
            ...model.form,
            submitting: false,
            errorMessage: afcQaTesterSubmitErrorMessage(event.status),
          },
        },
        effect: NONE,
      };
    }
    case "clear_success": {
      return {
        state: { ...model, successMessage: null },
        effect: NONE,
      };
    }
    case "rerun_requested": {
      if (model.rerunPending) {
        return { state: model, effect: NONE };
      }
      const generationId = reportableGenerationId(model.projection);
      if (
        !model.roomId ||
        !generationId ||
        !canShowAfcQaReadyRerun({
          projection: model.projection,
          preparePhase: event.preparePhase,
          prepareGenerationId: event.prepareGenerationId,
        })
      ) {
        return { state: model, effect: NONE };
      }
      return {
        state: {
          ...model,
          rerunPending: true,
          rerunBoundGenerationId: generationId,
          noticeMessage: null,
          successMessage: null,
        },
        effect: {
          type: "post_rerun",
          url: AFC_QA_READY_RERUN_PATH,
          body: buildAfcQaReadyRerunBody({
            roomId: model.roomId,
            generationId,
          }),
        },
      };
    }
    case "rerun_succeeded": {
      return {
        state: {
          ...model,
          rerunPending: false,
          rerunBoundGenerationId: null,
          noticeMessage: null,
        },
        effect: { type: "refresh_qa" },
      };
    }
    case "rerun_http_error": {
      if (event.status === 401) {
        return {
          state: {
            ...model,
            rerunPending: false,
            noticeMessage: AFC_QA_TESTER_COPY.sessionExpired,
          },
          effect: { type: "unauthorized" },
        };
      }
      if (event.status === 404) {
        return {
          state: {
            ...model,
            rerunPending: false,
            rerunBoundGenerationId: null,
            noticeMessage: AFC_QA_TESTER_COPY.rerunError404,
          },
          effect: { type: "refresh_qa" },
        };
      }
      return {
        state: {
          ...model,
          rerunPending: false,
          noticeMessage: afcQaReadyRerunErrorMessage(event.status),
        },
        effect: event.status === 400 ? { type: "refresh_qa" } : NONE,
      };
    }
    case "rerun_aborted": {
      if (!model.rerunPending) {
        return { state: model, effect: NONE };
      }
      return {
        state: {
          ...model,
          rerunPending: false,
          rerunBoundGenerationId: null,
        },
        effect: NONE,
      };
    }
    default: {
      return { state: model, effect: NONE };
    }
  }
}
