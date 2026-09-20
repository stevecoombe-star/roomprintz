"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  AFC_DIAGNOSTIC_INBOX_COPY,
  AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS,
  AFC_DIAGNOSTIC_INBOX_MACHINE_OPTIONS,
  AFC_DIAGNOSTIC_INBOX_REVIEW_OPTIONS,
  AFC_DIAGNOSTIC_INBOX_TRIGGER_OPTIONS,
  afcDiagnosticInboxAttemptLabel,
  afcDiagnosticInboxHasCommittedFilters,
  afcDiagnosticInboxIssueDisplay,
  afcDiagnosticInboxLoadErrorMessage,
  afcDiagnosticInboxMachineLabel,
  afcDiagnosticInboxReviewLabel,
  afcDiagnosticInboxSessionStatusLabel,
  afcDiagnosticInboxSourceText,
  buildAfcDiagnosticInboxListUrl,
  buildAfcDiagnosticInboxPageHref,
  createAfcDiagnosticInboxRequestCoordinator,
  applyAfcDiagnosticInboxSelectFilter,
  emptyAfcDiagnosticInboxCommittedFilters,
  formatAfcDiagnosticInboxSubmittedAt,
  isAfcDiagnosticInboxAbortError,
  isoTimestampToLocalDateInput,
  mergeAfcDiagnosticInboxItems,
  parseAfcDiagnosticInboxCommittedFilters,
  parseAfcDiagnosticInboxListPayload,
  shortAfcDiagnosticUuid,
  validateAfcDiagnosticInboxDraftFilters,
  type AfcDiagnosticAdminCaseSummary,
  type AfcDiagnosticInboxCommittedFilters,
  type AfcDiagnosticInboxFetchMode,
} from "@/lib/afc-v2-diagnostics/admin-case-inbox.client";

const controlClassName =
  "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none transition focus:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-400/80";

const buttonClassName =
  "rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 disabled:opacity-60";

function reviewBadgeClass(status: string): string {
  if (status === "in_review") {
    return "border-amber-500/50 bg-amber-950/40 text-amber-200";
  }
  if (status === "closed") {
    return "border-slate-600 bg-slate-900 text-slate-400";
  }
  return "border-slate-500 bg-slate-800/80 text-slate-200";
}

function machineBadgeClass(status: string): string {
  if (status === "running") {
    return "border-sky-500/50 bg-sky-950/40 text-sky-200";
  }
  if (status === "failed") {
    return "border-rose-500/50 bg-rose-950/40 text-rose-200";
  }
  return "border-cyan-600/40 bg-slate-900 text-cyan-200";
}

function CopyIdButton({
  value,
  ariaLabel,
}: {
  value: string;
  ariaLabel: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
          if (timeoutRef.current != null) {
            window.clearTimeout(timeoutRef.current);
          }
          timeoutRef.current = window.setTimeout(() => {
            setState("idle");
          }, 1500);
        })();
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

function IdRow({
  label,
  id,
  ariaLabel,
  extra,
}: {
  label: string;
  id: string;
  ariaLabel: string;
  extra?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <span className="font-mono text-[11px] text-slate-200" title={id}>
        {shortAfcDiagnosticUuid(id)}
      </span>
      {extra ? <span className="text-[11px] text-slate-500">· {extra}</span> : null}
      <CopyIdButton value={id} ariaLabel={ariaLabel} />
    </div>
  );
}

export default function AfcDiagnosticCaseInbox() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const coordinatorRef = useRef(createAfcDiagnosticInboxRequestCoordinator());

  const committed = useMemo(
    () => parseAfcDiagnosticInboxCommittedFilters(searchParams),
    [searchParams],
  );
  const committedKey = useMemo(
    () => serializeCommittedKey(committed),
    [committed],
  );

  const [draftRoomId, setDraftRoomId] = useState(
    () => committed.roomId ?? "",
  );
  const [draftSubmittedFrom, setDraftSubmittedFrom] = useState(
    () =>
      committed.submittedFrom
        ? isoTimestampToLocalDateInput(committed.submittedFrom)
        : "",
  );
  const [draftSubmittedTo, setDraftSubmittedTo] = useState(
    () =>
      committed.submittedTo
        ? isoTimestampToLocalDateInput(committed.submittedTo)
        : "",
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [items, setItems] = useState<AfcDiagnosticAdminCaseSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "refreshing" | "loadingMore" | "ready" | "error"
  >("loading");
  const [requestActive, setRequestActive] = useState(false);

  useEffect(() => {
    setDraftRoomId(committed.roomId ?? "");
    setDraftSubmittedFrom(
      committed.submittedFrom
        ? isoTimestampToLocalDateInput(committed.submittedFrom)
        : "",
    );
    setDraftSubmittedTo(
      committed.submittedTo
        ? isoTimestampToLocalDateInput(committed.submittedTo)
        : "",
    );
    setValidationMessage(null);
  }, [committed.roomId, committed.submittedFrom, committed.submittedTo]);

  const replaceFilters = useCallback(
    (next: AfcDiagnosticInboxCommittedFilters) => {
      router.replace(buildAfcDiagnosticInboxPageHref(next), { scroll: false });
    },
    [router],
  );

  const runFetch = useCallback(
    async (
      mode: AfcDiagnosticInboxFetchMode,
      filters: AfcDiagnosticInboxCommittedFilters,
      cursor: string | null,
    ) => {
      const started = coordinatorRef.current.begin(mode);
      if (!started.started) return;
      setRequestActive(true);
      setErrorMessage(null);
      setValidationMessage(null);
      if (mode === "page1") setPhase("loading");
      if (mode === "refresh") setPhase("refreshing");
      if (mode === "more") setPhase("loadingMore");
      if (started.replaceItems) {
        setItems([]);
        setNextCursor(null);
      }

      try {
        const response = await fetch(buildAfcDiagnosticInboxListUrl(filters, cursor), {
          credentials: "same-origin",
          cache: "no-store",
          signal: started.signal,
        });
        if (!coordinatorRef.current.isCurrent(started.seq)) return;

        if (!response.ok) {
          setErrorMessage(afcDiagnosticInboxLoadErrorMessage(response.status));
          setPhase("error");
          if (started.replaceItems) {
            setItems([]);
            setNextCursor(null);
          }
          return;
        }

        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          payload = null;
        }
        if (!coordinatorRef.current.isCurrent(started.seq)) return;

        const parsed = parseAfcDiagnosticInboxListPayload(payload);
        if (!parsed) {
          setErrorMessage(afcDiagnosticInboxLoadErrorMessage(500));
          setPhase("error");
          if (started.replaceItems) {
            setItems([]);
            setNextCursor(null);
          }
          return;
        }

        if (mode === "more") {
          setItems((previous) => mergeAfcDiagnosticInboxItems(previous, parsed.items));
        } else {
          setItems([...parsed.items]);
        }
        setNextCursor(parsed.nextCursor);
        setPhase("ready");
      } catch (error) {
        if (isAfcDiagnosticInboxAbortError(error)) return;
        if (!coordinatorRef.current.isCurrent(started.seq)) return;
        setErrorMessage(afcDiagnosticInboxLoadErrorMessage("network"));
        setPhase("error");
        if (started.replaceItems) {
          setItems([]);
          setNextCursor(null);
        }
      } finally {
        if (coordinatorRef.current.isCurrent(started.seq)) {
          coordinatorRef.current.finish(started.seq);
          setRequestActive(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void runFetch("page1", committed, null);
  }, [committed, committedKey, runFetch]);

  const applyDrafts = (event?: FormEvent) => {
    event?.preventDefault();
    const validated = validateAfcDiagnosticInboxDraftFilters({
      roomId: draftRoomId,
      submittedFrom: draftSubmittedFrom,
      submittedTo: draftSubmittedTo,
    });
    if (!validated.ok) {
      setValidationMessage(validated.message);
      return;
    }
    setValidationMessage(null);
    replaceFilters({
      ...committed,
      roomId: validated.roomId,
      submittedFrom: validated.submittedFrom,
      submittedTo: validated.submittedTo,
    });
  };

  const clearFilters = () => {
    const empty = emptyAfcDiagnosticInboxCommittedFilters();
    setDraftRoomId("");
    setDraftSubmittedFrom("");
    setDraftSubmittedTo("");
    setValidationMessage(null);
    replaceFilters(empty);
    void runFetch("page1", empty, null);
  };

  const replaceSelect = (
    key: "reviewStatus" | "trigger" | "issueCode" | "machineStatusSnapshot",
    value: string,
  ) => {
    replaceFilters(applyAfcDiagnosticInboxSelectFilter(committed, key, value));
  };

  const busy = phase === "loading" || phase === "refreshing";
  const showEmpty =
    phase === "ready" && items.length === 0 && errorMessage == null;
  const filteredEmpty = afcDiagnosticInboxHasCommittedFilters(committed);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {AFC_DIAGNOSTIC_INBOX_COPY.title}
              </h1>
              <p className="text-sm text-slate-400">
                {AFC_DIAGNOSTIC_INBOX_COPY.subtitle}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/admin"
                className={buttonClassName}
              >
                {AFC_DIAGNOSTIC_INBOX_COPY.backToAdmin}
              </Link>
              <button
                type="button"
                className={buttonClassName}
                disabled={requestActive}
                onClick={() => void runFetch("refresh", committed, null)}
              >
                {phase === "refreshing"
                  ? AFC_DIAGNOSTIC_INBOX_COPY.refreshing
                  : AFC_DIAGNOSTIC_INBOX_COPY.refresh}
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <form className="flex flex-wrap items-end gap-3" onSubmit={applyDrafts}>
            <label className="flex min-w-[10rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Review</span>
              <select
                value={committed.reviewStatus ?? ""}
                onChange={(event) => replaceSelect("reviewStatus", event.target.value)}
                className={controlClassName}
              >
                <option value="">Any</option>
                {AFC_DIAGNOSTIC_INBOX_REVIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[12rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Issue</span>
              <select
                value={committed.issueCode ?? ""}
                onChange={(event) => replaceSelect("issueCode", event.target.value)}
                className={controlClassName}
              >
                <option value="">Any</option>
                {AFC_DIAGNOSTIC_INBOX_ISSUE_OPTIONS.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[12rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Trigger</span>
              <select
                value={committed.trigger ?? ""}
                onChange={(event) => replaceSelect("trigger", event.target.value)}
                className={controlClassName}
              >
                <option value="">Any</option>
                {AFC_DIAGNOSTIC_INBOX_TRIGGER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[10rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Machine</span>
              <select
                value={committed.machineStatusSnapshot ?? ""}
                onChange={(event) =>
                  replaceSelect("machineStatusSnapshot", event.target.value)
                }
                className={controlClassName}
              >
                <option value="">Any</option>
                {AFC_DIAGNOSTIC_INBOX_MACHINE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <span className="text-xs text-slate-400">Room ID</span>
              <input
                type="text"
                value={draftRoomId}
                onChange={(event) => setDraftRoomId(event.target.value)}
                className={controlClassName}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="flex min-w-[10rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Submitted from (local)</span>
              <input
                type="date"
                value={draftSubmittedFrom}
                onChange={(event) => setDraftSubmittedFrom(event.target.value)}
                className={controlClassName}
              />
            </label>

            <label className="flex min-w-[10rem] flex-col gap-1">
              <span className="text-xs text-slate-400">Submitted to (local)</span>
              <input
                type="date"
                value={draftSubmittedTo}
                onChange={(event) => setDraftSubmittedTo(event.target.value)}
                className={controlClassName}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={buttonClassName}>
                {AFC_DIAGNOSTIC_INBOX_COPY.apply}
              </button>
              <button
                type="button"
                className={buttonClassName}
                onClick={clearFilters}
              >
                {AFC_DIAGNOSTIC_INBOX_COPY.clearFilters}
              </button>
            </div>
          </form>
          {validationMessage ? (
            <p className="mt-3 text-xs text-rose-300">{validationMessage}</p>
          ) : null}
        </section>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-2xl border border-rose-700/60 bg-rose-950/20 p-4"
          >
            <p className="text-sm text-rose-200">{errorMessage}</p>
            <button
              type="button"
              className={`${buttonClassName} mt-3`}
              onClick={() => void runFetch("page1", committed, null)}
            >
              {AFC_DIAGNOSTIC_INBOX_COPY.retry}
            </button>
          </div>
        ) : null}

        <section
          className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4"
          aria-busy={busy}
        >
          {busy && items.length === 0 ? (
            <p className="text-sm text-slate-400">{AFC_DIAGNOSTIC_INBOX_COPY.loading}</p>
          ) : null}

          {showEmpty ? (
            <p className="text-sm text-slate-400">
              {filteredEmpty
                ? AFC_DIAGNOSTIC_INBOX_COPY.emptyFiltered
                : AFC_DIAGNOSTIC_INBOX_COPY.emptyUnfiltered}
            </p>
          ) : null}

          {items.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Submitted (local)
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Review
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Issue
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Source
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Machine
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Attempts
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Notes
                      </th>
                      <th
                        scope="col"
                        className="hidden whitespace-nowrap px-3 py-2 font-medium md:table-cell"
                      >
                        IDs
                      </th>
                      <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                        Open
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const submitted = formatAfcDiagnosticInboxSubmittedAt(
                        item.submittedAt,
                      );
                      const issues = afcDiagnosticInboxIssueDisplay(item.issueCodes);
                      return (
                        <tr key={item.caseId} className="border-t border-slate-800">
                          <td className="whitespace-nowrap px-3 py-3 text-slate-200">
                            <span title={submitted.title}>{submitted.display}</span>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${reviewBadgeClass(item.reviewStatus)}`}
                            >
                              {afcDiagnosticInboxReviewLabel(item.reviewStatus)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1" title={issues.title}>
                              {issues.chips.length === 0 ? (
                                <span className="text-slate-500">—</span>
                              ) : (
                                issues.chips.map((chip) => (
                                  <span
                                    key={chip.key}
                                    title={chip.title}
                                    className="inline-flex rounded-md border border-slate-600 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-200"
                                  >
                                    {chip.label}
                                  </span>
                                ))
                              )}
                              {issues.overflowCount > 0 ? (
                                <span
                                  title={issues.title}
                                  className="inline-flex rounded-md border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-400"
                                >
                                  +{issues.overflowCount}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-200">
                            {afcDiagnosticInboxSourceText(item.origin, item.trigger)}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-flex rounded-md border px-1.5 py-0.5 text-[11px] ${machineBadgeClass(item.machineStatusSnapshot)}`}
                            >
                              {afcDiagnosticInboxMachineLabel(item.machineStatusSnapshot)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-slate-200">
                            {afcDiagnosticInboxAttemptLabel(item.sessionAttemptCount)}
                          </td>
                          <td className="px-3 py-3">
                            {item.hasNotes ? (
                              <span className="inline-flex rounded-md border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-400">
                                {AFC_DIAGNOSTIC_INBOX_COPY.notes}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                          <td className="hidden px-3 py-3 md:table-cell">
                            <div className="space-y-1">
                              <IdRow
                                label="Case"
                                id={item.caseId}
                                ariaLabel="Copy Case ID"
                              />
                              <IdRow
                                label="Room"
                                id={item.roomId}
                                ariaLabel="Copy Room ID"
                              />
                              <IdRow
                                label="Session"
                                id={item.sessionId}
                                ariaLabel="Copy Session ID"
                                extra={afcDiagnosticInboxSessionStatusLabel(
                                  item.sessionStatus,
                                )}
                              />
                              <IdRow
                                label="Gen"
                                id={item.reportedGenerationId}
                                ariaLabel="Copy Generation ID"
                              />
                              <IdRow
                                label="Reporter"
                                id={item.reporterUserId}
                                ariaLabel="Copy Reporter ID"
                              />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <Link
                              href={`/admin/afc-diagnostics/cases/${item.caseId}`}
                              prefetch={false}
                              className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80"
                            >
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {nextCursor ? (
                <div className="mt-4">
                  <button
                    type="button"
                    className={buttonClassName}
                    disabled={requestActive}
                    onClick={() => void runFetch("more", committed, nextCursor)}
                  >
                    {phase === "loadingMore"
                      ? AFC_DIAGNOSTIC_INBOX_COPY.loadMoreLoading
                      : AFC_DIAGNOSTIC_INBOX_COPY.loadMore}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function serializeCommittedKey(filters: AfcDiagnosticInboxCommittedFilters): string {
  return buildAfcDiagnosticInboxPageHref(filters);
}
