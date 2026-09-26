"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import { useAfcQaState } from "@/lib/afc-v2-diagnostics/use-afc-qa-state";
import {
  AFC_QA_TESTER_COPY,
  AFC_QA_TESTER_ISSUE_OPTIONS,
  deriveAfcQaTesterReportView,
  createInitialAfcQaTesterReportModel,
  reduceAfcQaTesterReport,
  shouldRefreshAfcQaStateAfterPrepareSettle,
  type AfcQaIssueCode,
  type AfcQaTesterReportEffect,
  type AfcQaTesterReportEvent,
  type AfcQaTesterReportModel,
  type AfcQaTesterReportViewModel,
} from "@/lib/afc-v2-diagnostics/tester-report.client";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const CONTROL =
  "rounded-md border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-neutral-800 disabled:opacity-50";

const PRIMARY =
  "rounded-md border border-neutral-200 bg-neutral-100 px-2.5 py-1.5 text-xs font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50";

type AfcQaTesterReportProps = Readonly<{
  roomId: string | null;
  preparePhase?: string | null;
  prepareGenerationId?: string | null;
  onUnauthorized?: () => void;
  onRerunStart?: () => boolean;
  onRerunSettled?: (input: {
    ok: boolean;
    payload?: unknown;
    failureReason?: string | null;
  }) => void;
  onRerunReverted?: () => void;
  onPerspectiveRereadStart?: () => boolean;
  onPerspectiveRereadSettled?: (input: {
    ok: boolean;
    payload?: unknown;
    failureReason?: string | null;
  }) => void;
  onPerspectiveRereadReverted?: () => void;
}>;

export type AfcQaTesterReportViewProps = Readonly<{
  view: AfcQaTesterReportViewModel;
  onOpenManual: () => void;
  onOpenAutomatic: () => void;
  onDismissAutomatic: () => void;
  onCancelForm: () => void;
  onToggleIssue: (code: AfcQaIssueCode) => void;
  onNotesChange: (notes: string) => void;
  onSubmit: () => void;
  onRerun: () => void;
  onPerspectiveReread: () => void;
}>;

function isSelected(
  selectedCodes: readonly AfcQaIssueCode[],
  code: AfcQaIssueCode,
): boolean {
  return selectedCodes.includes(code);
}

export function AfcQaTesterReportView({
  view,
  onOpenManual,
  onOpenAutomatic,
  onDismissAutomatic,
  onCancelForm,
  onToggleIssue,
  onNotesChange,
  onSubmit,
  onRerun,
  onPerspectiveReread,
}: AfcQaTesterReportViewProps) {
  const titleId = useId();
  const promptTitleId = useId();
  const notesId = useId();
  const errorId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!view.showForm && !view.showAutomaticPrompt) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (view.showForm) onCancelForm();
      else onDismissAutomatic();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    view.showForm,
    view.showAutomaticPrompt,
    onCancelForm,
    onDismissAutomatic,
  ]);

  useEffect(() => {
    if (!view.showForm) return;
    const firstCheckbox = formRef.current?.querySelector("input[type='checkbox']");
    if (firstCheckbox instanceof HTMLInputElement) firstCheckbox.focus();
  }, [view.showForm]);

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelForm();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  if (
    !view.showManualReport &&
    !view.showRerun &&
    !view.showPerspectiveReread &&
    !view.showAutomaticPrompt &&
    !view.showForm &&
    !view.successMessage &&
    !view.noticeMessage
  ) {
    return null;
  }

  return (
    <div className="flex items-center gap-2" data-afc-qa-tester-report="true">
      {view.showManualReport ? (
        <button
          type="button"
          data-afc-qa-manual-entry="true"
          className={`rounded-md border border-transparent px-2 py-1 text-xs text-neutral-400 transition hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200 ${FOCUS}`}
          onClick={onOpenManual}
        >
          {AFC_QA_TESTER_COPY.manualButton}
        </button>
      ) : null}

      {view.showPerspectiveReread ? (
        <button
          type="button"
          data-afc-qa-perspective-reread="true"
          className={`rounded-md border border-transparent px-2 py-1 text-xs text-neutral-400 transition hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200 disabled:opacity-50 ${FOCUS}`}
          disabled={view.perspectiveRereadDisabled}
          aria-busy={view.perspectiveRereadBusy}
          title={AFC_QA_TESTER_COPY.rereadTitle}
          onClick={onPerspectiveReread}
        >
          {view.perspectiveRereadLabel}
        </button>
      ) : null}

      {view.showRerun ? (
        <button
          type="button"
          data-afc-qa-ready-rerun="true"
          className={`rounded-md border border-transparent px-2 py-1 text-xs text-neutral-400 transition hover:border-neutral-800 hover:bg-neutral-900 hover:text-neutral-200 disabled:opacity-50 ${FOCUS}`}
          disabled={view.rerunDisabled}
          aria-busy={view.rerunDisabled}
          onClick={onRerun}
        >
          {AFC_QA_TESTER_COPY.rerunButton}
        </button>
      ) : null}

      {view.successMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="max-w-[16rem] text-[11px] text-neutral-400"
        >
          {view.successMessage}
        </p>
      ) : null}

      {view.noticeMessage ? (
        <p
          role="status"
          aria-live="polite"
          className="max-w-[16rem] text-[11px] text-neutral-400"
        >
          {view.noticeMessage}
        </p>
      ) : null}

      {view.showAutomaticPrompt ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={promptTitleId}
          data-afc-qa-automatic-prompt="true"
        >
          <div className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl">
            <h2
              id={promptTitleId}
              className="text-sm font-medium text-neutral-100"
            >
              {AFC_QA_TESTER_COPY.promptTitle}
            </h2>
            <p className="mt-2 text-xs leading-5 text-neutral-400">
              {AFC_QA_TESTER_COPY.promptBody}
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className={`${CONTROL} ${FOCUS}`}
                onClick={onDismissAutomatic}
              >
                {AFC_QA_TESTER_COPY.promptDismiss}
              </button>
              <button
                type="button"
                className={`${PRIMARY} ${FOCUS}`}
                onClick={onOpenAutomatic}
              >
                {AFC_QA_TESTER_COPY.promptReport}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view.showForm ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-afc-qa-report-form="true"
        >
          <form
            ref={formRef}
            className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-xl"
            onSubmit={handleSubmit}
            onKeyDown={handleFormKeyDown}
          >
            <h2 id={titleId} className="text-sm font-medium text-neutral-100">
              Report an issue
            </h2>
            <p className="mt-1 text-xs text-neutral-400">
              Select anything that looks off. You can choose more than one.
            </p>

            <fieldset className="mt-4 space-y-2" disabled={view.submitting}>
              <legend className="sr-only">Issues</legend>
              {AFC_QA_TESTER_ISSUE_OPTIONS.map((option, index) => {
                const checkboxId = `${titleId}-issue-${index}`;
                return (
                  <label
                    key={option.label}
                    htmlFor={checkboxId}
                    className="flex cursor-pointer items-start gap-2 text-sm text-neutral-200"
                  >
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className={`mt-0.5 ${FOCUS}`}
                      checked={isSelected(view.selectedCodes, option.code)}
                      onChange={() => onToggleIssue(option.code)}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </fieldset>

            <label
              htmlFor={notesId}
              className="mt-4 block text-[11px] text-neutral-400"
            >
              {AFC_QA_TESTER_COPY.notesLabel}
            </label>
            <textarea
              id={notesId}
              value={view.notes}
              maxLength={view.notesMaxChars}
              disabled={view.submitting}
              placeholder={AFC_QA_TESTER_COPY.notesPlaceholder}
              onChange={(event) => onNotesChange(event.target.value)}
              className={`mt-1 h-24 w-full resize-y rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 outline-none ${FOCUS}`}
            />
            <p className="mt-1 text-[11px] text-neutral-500">
              {view.notes.length}/{view.notesMaxChars}
            </p>

            {view.formError ? (
              <p
                id={errorId}
                role="alert"
                className="mt-2 text-xs text-rose-300"
              >
                {view.formError}
              </p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                className={`${CONTROL} ${FOCUS}`}
                disabled={view.submitting}
                onClick={onCancelForm}
              >
                {AFC_QA_TESTER_COPY.cancel}
              </button>
              <button
                type="submit"
                className={`${PRIMARY} ${FOCUS}`}
                disabled={!view.canSubmit}
                aria-busy={view.submitting}
                aria-describedby={view.formError ? errorId : undefined}
              >
                {AFC_QA_TESTER_COPY.submit}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function AfcQaTesterReport({
  roomId,
  preparePhase = null,
  prepareGenerationId = null,
  onUnauthorized,
  onRerunStart,
  onRerunSettled,
  onRerunReverted,
  onPerspectiveRereadStart,
  onPerspectiveRereadSettled,
  onPerspectiveRereadReverted,
}: AfcQaTesterReportProps) {
  const [reloadKey, setReloadKey] = useState(0);
  const previousPhaseRef = useRef<string | null>(null);
  const modelRef = useRef<AfcQaTesterReportModel>(
    createInitialAfcQaTesterReportModel(roomId),
  );
  const [model, setModel] = useState<AfcQaTesterReportModel>(
    modelRef.current,
  );
  const submitInFlightRef = useRef(false);
  const rerunInFlightRef = useRef(false);
  const perspectiveRereadInFlightRef = useRef(false);
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const projection = useAfcQaState(roomId, { reloadKey });

  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = preparePhase ?? null;
    if (
      shouldRefreshAfcQaStateAfterPrepareSettle({
        previousPhase: previous,
        nextPhase: preparePhase ?? null,
      })
    ) {
      setReloadKey((current) => current + 1);
    }
  }, [preparePhase]);

  const dispatch = useCallback((event: AfcQaTesterReportEvent): AfcQaTesterReportEffect => {
    const result = reduceAfcQaTesterReport(modelRef.current, event);
    modelRef.current = result.state;
    setModel(result.state);
    return result.effect;
  }, []);

  useEffect(() => {
    dispatch({ type: "room_changed", roomId });
  }, [dispatch, roomId]);

  useEffect(() => {
    if (projection.loading && !projection.state) {
      dispatch({ type: "projection_loading" });
      return;
    }
    if (projection.state) {
      dispatch({ type: "projection_ready", projection: projection.state });
      return;
    }
    if (projection.error) {
      dispatch({ type: "projection_error" });
    }
  }, [dispatch, projection.error, projection.loading, projection.state]);

  useEffect(() => {
    if (!model.successMessage) return;
    const timer = window.setTimeout(() => {
      dispatch({ type: "clear_success" });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [dispatch, model.successMessage]);

  const applyEffect = useCallback(
    (effect: AfcQaTesterReportEffect) => {
      if (effect.type === "refresh_qa") projection.reload();
      if (effect.type === "unauthorized") onUnauthorized?.();
    },
    [onUnauthorized, projection],
  );

  const onOpenManual = useCallback(() => {
    applyEffect(dispatch({ type: "open_manual" }));
  }, [applyEffect, dispatch]);

  const onOpenAutomatic = useCallback(() => {
    applyEffect(dispatch({ type: "open_automatic" }));
  }, [applyEffect, dispatch]);

  const onDismissAutomatic = useCallback(() => {
    applyEffect(dispatch({ type: "dismiss_automatic" }));
  }, [applyEffect, dispatch]);

  const onCancelForm = useCallback(() => {
    applyEffect(dispatch({ type: "cancel_form" }));
  }, [applyEffect, dispatch]);

  const onToggleIssue = useCallback(
    (code: AfcQaIssueCode) => {
      applyEffect(dispatch({ type: "toggle_issue", code }));
    },
    [applyEffect, dispatch],
  );

  const onNotesChange = useCallback(
    (notes: string) => {
      applyEffect(dispatch({ type: "set_notes", notes }));
    },
    [applyEffect, dispatch],
  );

  const onSubmit = useCallback(() => {
    if (submitInFlightRef.current) return;
    submitInFlightRef.current = true;
    const effect = dispatch({ type: "submit_requested" });
    if (effect.type !== "post_case") {
      submitInFlightRef.current = false;
      applyEffect(effect);
      return;
    }
    void (async () => {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          applyEffect(dispatch({ type: "submit_http_error", status: 401 }));
          return;
        }
        const response = await fetch(effect.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(effect.body),
          cache: "no-store",
        });
        if (response.status === 401) {
          applyEffect(dispatch({ type: "submit_http_error", status: 401 }));
          return;
        }
        if (!response.ok) {
          applyEffect(
            dispatch({ type: "submit_http_error", status: response.status }),
          );
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | { submitted?: unknown }
          | null;
        if (payload?.submitted === true) {
          applyEffect(dispatch({ type: "submit_succeeded" }));
          return;
        }
        applyEffect(dispatch({ type: "submit_http_error", status: 500 }));
      } catch {
        applyEffect(dispatch({ type: "submit_http_error", status: 500 }));
      } finally {
        submitInFlightRef.current = false;
      }
    })();
  }, [applyEffect, dispatch]);

  const onRerun = useCallback(() => {
    if (rerunInFlightRef.current || perspectiveRereadInFlightRef.current) return;
    rerunInFlightRef.current = true;
    const effect = dispatch({
      type: "rerun_requested",
      preparePhase,
      prepareGenerationId,
    });
    if (effect.type !== "post_rerun") {
      rerunInFlightRef.current = false;
      applyEffect(effect);
      return;
    }
    if (onRerunStart && !onRerunStart()) {
      applyEffect(dispatch({ type: "rerun_aborted" }));
      rerunInFlightRef.current = false;
      return;
    }
    const requestedRoomId = effect.body.roomId;
    void (async () => {
      const revertPrepare = () => onRerunReverted?.();
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          revertPrepare();
          applyEffect(dispatch({ type: "rerun_http_error", status: 401 }));
          return;
        }
        const response = await fetch(effect.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(effect.body),
          cache: "no-store",
        });
        if (roomIdRef.current !== requestedRoomId) {
          revertPrepare();
          return;
        }
        if (response.status === 401) {
          revertPrepare();
          applyEffect(dispatch({ type: "rerun_http_error", status: 401 }));
          return;
        }
        if (!response.ok) {
          if (response.status === 422) {
            const payload = (await response.json().catch(() => null)) as
              | { failureReason?: unknown }
              | null;
            onRerunSettled?.({
              ok: false,
              payload,
              failureReason:
                typeof payload?.failureReason === "string"
                  ? payload.failureReason
                  : null,
            });
            applyEffect(dispatch({ type: "rerun_succeeded" }));
            return;
          }
          revertPrepare();
          applyEffect(
            dispatch({ type: "rerun_http_error", status: response.status }),
          );
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | { status?: unknown }
          | null;
        if (payload?.status === "ready") {
          onRerunSettled?.({ ok: true, payload });
          applyEffect(dispatch({ type: "rerun_succeeded" }));
          return;
        }
        revertPrepare();
        applyEffect(dispatch({ type: "rerun_http_error", status: 500 }));
      } catch {
        if (roomIdRef.current === requestedRoomId) {
          revertPrepare();
          applyEffect(dispatch({ type: "rerun_http_error", status: 500 }));
        }
      } finally {
        rerunInFlightRef.current = false;
      }
    })();
  }, [
    applyEffect,
    dispatch,
    onRerunReverted,
    onRerunSettled,
    onRerunStart,
    prepareGenerationId,
    preparePhase,
  ]);

  const onPerspectiveReread = useCallback(() => {
    if (rerunInFlightRef.current || perspectiveRereadInFlightRef.current) return;
    perspectiveRereadInFlightRef.current = true;
    const effect = dispatch({
      type: "perspective_reread_requested",
      preparePhase,
      prepareGenerationId,
    });
    if (effect.type !== "post_perspective_reread") {
      perspectiveRereadInFlightRef.current = false;
      applyEffect(effect);
      return;
    }
    if (onPerspectiveRereadStart && !onPerspectiveRereadStart()) {
      applyEffect(dispatch({ type: "perspective_reread_aborted" }));
      perspectiveRereadInFlightRef.current = false;
      return;
    }
    const requestedRoomId = effect.body.roomId;
    void (async () => {
      const revertPrepare = () => onPerspectiveRereadReverted?.();
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token) {
          revertPrepare();
          applyEffect(
            dispatch({ type: "perspective_reread_http_error", status: 401 }),
          );
          return;
        }
        const response = await fetch(effect.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(effect.body),
          cache: "no-store",
        });
        if (roomIdRef.current !== requestedRoomId) {
          revertPrepare();
          return;
        }
        if (response.status === 401) {
          revertPrepare();
          applyEffect(
            dispatch({ type: "perspective_reread_http_error", status: 401 }),
          );
          return;
        }
        if (!response.ok) {
          if (response.status === 422) {
            const payload = (await response.json().catch(() => null)) as
              | { failureReason?: unknown }
              | null;
            onPerspectiveRereadSettled?.({
              ok: false,
              payload,
              failureReason:
                typeof payload?.failureReason === "string"
                  ? payload.failureReason
                  : null,
            });
          } else {
            revertPrepare();
          }
          applyEffect(
            dispatch({
              type: "perspective_reread_http_error",
              status: response.status,
            }),
          );
          return;
        }
        const payload = (await response.json().catch(() => null)) as
          | { status?: unknown }
          | null;
        if (payload?.status === "ready") {
          onPerspectiveRereadSettled?.({ ok: true, payload });
          applyEffect(dispatch({ type: "perspective_reread_succeeded" }));
          return;
        }
        revertPrepare();
        applyEffect(
          dispatch({ type: "perspective_reread_http_error", status: 500 }),
        );
      } catch {
        if (roomIdRef.current === requestedRoomId) {
          revertPrepare();
          applyEffect(
            dispatch({ type: "perspective_reread_http_error", status: 500 }),
          );
        }
      } finally {
        perspectiveRereadInFlightRef.current = false;
      }
    })();
  }, [
    applyEffect,
    dispatch,
    onPerspectiveRereadReverted,
    onPerspectiveRereadSettled,
    onPerspectiveRereadStart,
    prepareGenerationId,
    preparePhase,
  ]);

  const view = deriveAfcQaTesterReportView(model, {
    preparePhase,
    prepareGenerationId,
  });
  return (
    <AfcQaTesterReportView
      view={view}
      onOpenManual={onOpenManual}
      onOpenAutomatic={onOpenAutomatic}
      onDismissAutomatic={onDismissAutomatic}
      onCancelForm={onCancelForm}
      onToggleIssue={onToggleIssue}
      onNotesChange={onNotesChange}
      onSubmit={onSubmit}
      onRerun={onRerun}
      onPerspectiveReread={onPerspectiveReread}
    />
  );
}
