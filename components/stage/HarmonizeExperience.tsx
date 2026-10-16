"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useHarmonizeQaControl } from "@/components/stage/HarmonizeExportContext";
import { useStageEditor } from "@/components/stage/StageEditorContext";
import { harmonizeExportErrorMessage } from "@/lib/vibode-stage/harmonize-export";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import {
  HARMONIZE_AI_DISCLOSURE_TEXT,
  HARMONIZE_AI_LABEL,
  HARMONIZE_WATCH_STORAGE_KEY,
  harmonizeAssetClaim,
  harmonizeButtonAccess,
  harmonizeButtonLabel,
  harmonizeCanSubmit,
  harmonizeDisclosureGate,
  harmonizeExperiencePhase,
  harmonizePhaseBusy,
  harmonizeShouldPoll,
  harmonizeShouldSettlePublication,
  harmonizeWatchJobId,
  readHarmonizeExperienceJobRecord,
  readHarmonizeHistoryViewResponse,
  type HarmonizeDisclosureChoice,
  type HarmonizeExperienceJob,
  type HarmonizeExperiencePhase,
  type HarmonizeHistoryView,
} from "@/lib/vibode-stage/harmonize-experience";
import {
  HARMONIZE_QA_POLL_MS,
  createHarmonizeQaAttemptGate,
  submitHarmonizeQaAttempt,
} from "@/lib/vibode-stage/harmonize-qa";

const FOCUS =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-400";

const attemptGate = createHarmonizeQaAttemptGate();

type ExperienceValue = Readonly<{
  available: boolean | null;
  phase: HarmonizeExperiencePhase;
  job: HarmonizeExperienceJob | null;
  settlement: HarmonizeExperienceJob | null;
  note: string | null;
  startSubmit: () => boolean;
  finishSubmit: () => void;
  watchJob: (jobId: string) => void;
  setNote: (note: string | null) => void;
}>;

const HarmonizeExperienceContext = createContext<ExperienceValue | null>(null);

function useIsVibodeAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/admin-access", { method: "POST", cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { isAdmin?: unknown }) => {
        if (!cancelled) setIsAdmin(payload?.isAdmin === true);
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return isAdmin;
}

async function readExperienceRoom(roomId: string): Promise<
  | Readonly<{ available: true; job: HarmonizeExperienceJob | null }>
  | Readonly<{ available: false }>
> {
  const response = await fetch(
    `/api/vibode/harmonize/jobs?roomId=${encodeURIComponent(roomId)}`,
    { method: "GET", credentials: "same-origin", cache: "no-store" },
  );
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    return { available: false };
  }
  if (!response.ok) return { available: true, job: null };
  const body = await response.json().catch(() => null) as { job?: unknown } | null;
  return { available: true, job: readHarmonizeExperienceJobRecord(body?.job) };
}

export function HarmonizeExperienceProvider({
  roomId,
  children,
}: {
  roomId: string | null;
  children: ReactNode;
}) {
  const isAdmin = useIsVibodeAdmin();
  const [loadedRoomId, setLoadedRoomId] = useState<string | null>(null);
  const [loadedAvailable, setLoadedAvailable] = useState<boolean | null>(null);
  const [loadedJob, setLoadedJob] = useState<HarmonizeExperienceJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [watchedJobId, setWatchedJobId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const submitLock = useRef(false);
  const watchReady = useRef(false);
  const available = !isAdmin || !roomId || loadedRoomId !== roomId ? null : loadedAvailable;
  const job = !isAdmin || !roomId || loadedRoomId !== roomId ? null : loadedJob;
  const phase = harmonizeExperiencePhase({ submitting, job });
  const settlement = job && !submitting && harmonizeShouldSettlePublication({
    jobId: job.id,
    phase,
    watchedJobId,
  })
    ? job
    : null;

  useEffect(() => {
    const stored = window.sessionStorage.getItem(HARMONIZE_WATCH_STORAGE_KEY);
    const timer = window.setTimeout(() => {
      watchReady.current = true;
      setWatchedJobId((current) => current ?? stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isAdmin || !roomId) return;
    let cancelled = false;
    const pull = () => {
      void readExperienceRoom(roomId).then((found) => {
        if (cancelled) return;
        const nextJob = found.available ? found.job : null;
        setLoadedRoomId(roomId);
        setLoadedAvailable(found.available);
        setLoadedJob(nextJob);
        if (!watchReady.current || submitLock.current || !nextJob) return;
        const nextPhase = harmonizeExperiencePhase({ submitting: false, job: nextJob });
        setWatchedJobId((current) => {
          if (harmonizeShouldSettlePublication({
            jobId: nextJob.id,
            phase: nextPhase,
            watchedJobId: current,
          })) {
            return current;
          }
          const next = harmonizeWatchJobId({
            jobId: nextJob.id,
            phase: nextPhase,
            watchedJobId: current,
          });
          if (next) window.sessionStorage.setItem(HARMONIZE_WATCH_STORAGE_KEY, next);
          else if (current) window.sessionStorage.removeItem(HARMONIZE_WATCH_STORAGE_KEY);
          return next;
        });
      }, () => {
        if (cancelled) return;
        setLoadedRoomId(roomId);
        setLoadedAvailable(false);
        setLoadedJob(null);
      });
    };
    pull();
    if (!harmonizeShouldPoll(phase) && !submitting) return () => {
      cancelled = true;
    };
    const timer = window.setInterval(pull, HARMONIZE_QA_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isAdmin, phase, reloadKey, roomId, submitting]);

  const value = useMemo<ExperienceValue>(() => ({
    available,
    phase,
    job,
    settlement,
    note,
    startSubmit: () => {
      if (submitLock.current) return false;
      const access = harmonizeButtonAccess({
        isAdmin: true,
        available,
        qaReady: true,
      });
      if (!harmonizeCanSubmit({ access, phase, gateHeld: submitting })) return false;
      submitLock.current = true;
      setSubmitting(true);
      setNote(null);
      return true;
    },
    finishSubmit: () => {
      submitLock.current = false;
      setSubmitting(false);
    },
    watchJob: (jobId: string) => {
      window.sessionStorage.setItem(HARMONIZE_WATCH_STORAGE_KEY, jobId);
      setWatchedJobId(jobId);
      setReloadKey((current) => current + 1);
    },
    setNote,
  }), [available, job, note, phase, settlement, submitting]);

  return (
    <HarmonizeExperienceContext.Provider value={value}>
      {children}
    </HarmonizeExperienceContext.Provider>
  );
}

export function useHarmonizeExperience(): ExperienceValue | null {
  return useContext(HarmonizeExperienceContext);
}

export function HarmonizePublicationWatcher({
  viewportMode,
  onPublished,
}: {
  viewportMode: "2d" | "3d";
  onPublished: (
    job: HarmonizeExperienceJob,
    live: Readonly<{ roomScaleMultiplier: number; objects: readonly unknown[] | null }>,
  ) => void;
}) {
  const stage = useStageEditor();
  const experience = useHarmonizeExperience();
  const handledJobId = useRef<string | null>(null);
  const settlementId = experience?.settlement?.id ?? null;
  useEffect(() => {
    const job = experience?.settlement;
    if (!job || handledJobId.current === job.id) return;
    if (viewportMode === "3d" && !stage.sceneReady) return;
    handledJobId.current = job.id;
    window.sessionStorage.removeItem(HARMONIZE_WATCH_STORAGE_KEY);
    onPublished(job, {
      roomScaleMultiplier: stage.roomScaleMultiplier,
      objects: stage.sceneReady ? stage.objects : null,
    });
  }, [
    experience?.settlement,
    onPublished,
    settlementId,
    stage.objects,
    stage.roomScaleMultiplier,
    stage.sceneReady,
    viewportMode,
  ]);
  return null;
}

export function useHarmonizedSelection(asset: unknown): Readonly<{
  view: HarmonizeHistoryView | null;
  status: "idle" | "loading" | "ready" | "unavailable";
}> {
  const claim = harmonizeAssetClaim(asset);
  const roomId = claim?.roomId ?? "";
  const assetId = claim?.assetId ?? "";
  const claimKey = roomId && assetId ? `${roomId}:${assetId}` : "";
  const [loaded, setLoaded] = useState<Readonly<{
    key: string;
    view: HarmonizeHistoryView | null;
    status: "ready" | "unavailable";
  }> | null>(null);
  useEffect(() => {
    if (!roomId || !assetId) return undefined;
    const key = `${roomId}:${assetId}`;
    let cancelled = false;
    void (async () => {
      const token = await getSupabaseBrowserAccessToken();
      if (cancelled) return;
      if (!token) {
        setLoaded({ key, view: null, status: "unavailable" });
        return;
      }
      try {
        const response = await fetch(
          `/api/vibode/harmonize/presentation?roomId=${encodeURIComponent(roomId)}&assetId=${encodeURIComponent(assetId)}`,
          {
            method: "GET",
            headers: {
              Accept: "application/json",
              Authorization: `Bearer ${token}`,
            },
            cache: "no-store",
          },
        );
        const body: unknown = await response.json().catch(() => null);
        if (cancelled) return;
        const parsed = response.ok ? readHarmonizeHistoryViewResponse(body) : null;
        if (!parsed || parsed === "ordinary" || parsed.assetId !== assetId) {
          setLoaded({ key, view: null, status: "unavailable" });
          return;
        }
        setLoaded({ key, view: parsed, status: "ready" });
      } catch {
        if (!cancelled) setLoaded({ key, view: null, status: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, roomId]);
  if (!claimKey) return { view: null, status: "idle" };
  if (!loaded || loaded.key !== claimKey) return { view: null, status: "loading" };
  return { view: loaded.view, status: loaded.status };
}

export function HarmonizeButton() {
  const isAdmin = useIsVibodeAdmin();
  const control = useHarmonizeQaControl();
  const experience = useHarmonizeExperience();
  const [disclosure, setDisclosure] = useState<HarmonizeDisclosureChoice>("unknown");
  const [dialogOpen, setDialogOpen] = useState(false);
  const acceptLock = useRef(false);
  const available = experience?.available ?? null;
  const phase = experience?.phase ?? "idle";
  const access = harmonizeButtonAccess({
    isAdmin,
    available,
    qaReady: Boolean(control?.qaReady),
  });

  useEffect(() => {
    if (access === "hidden" || available !== true) return;
    let cancelled = false;
    void fetch("/api/vibode/harmonize/acknowledgement", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (cancelled || !response.ok) return;
      const body = await response.json().catch(() => null) as { acknowledged?: unknown } | null;
      if (body?.acknowledged === true) setDisclosure("accepted");
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [access, available]);

  if (access === "hidden" || !experience || !control) return null;

  const disabled = !harmonizeCanSubmit({
    access,
    phase,
    gateHeld: phase === "preparing",
  });
  const label = harmonizeButtonLabel(phase);
  const title = available === false
    ? "Harmonize is unavailable."
    : !control.qaReady
      ? "Save this room version before Harmonize."
      : experience.note ?? experience.job?.failureMessage ?? "Harmonize this arrangement";

  const beginCapture = () => {
    const idempotencyKey = attemptGate.start();
    if (!idempotencyKey) return;
    if (!experience.startSubmit()) {
      attemptGate.finish();
      return;
    }
    void control.runQa(idempotencyKey).then(async (prepared) => {
      const enqueued = await submitHarmonizeQaAttempt(prepared);
      experience.watchJob(enqueued.jobId);
    }).catch((failure: unknown) => {
      experience.setNote(harmonizeExportErrorMessage(failure));
    }).finally(() => {
      attemptGate.finish();
      experience.finishSubmit();
    });
  };

  const onClick = () => {
    if (disabled) return;
    const gate = harmonizeDisclosureGate(disclosure);
    if (gate === "ask") {
      setDialogOpen(true);
      return;
    }
    if (gate === "stop") return;
    beginCapture();
  };

  const acceptDisclosure = () => {
    if (acceptLock.current) return;
    acceptLock.current = true;
    void fetch("/api/vibode/harmonize/acknowledgement", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    }).then(async (response) => {
      if (!response.ok) {
        experience.setNote("Harmonize disclosure could not be saved.");
        setDialogOpen(false);
        return;
      }
      setDisclosure("accepted");
      setDialogOpen(false);
      beginCapture();
    }).catch(() => {
      experience.setNote("Harmonize disclosure could not be saved.");
      setDialogOpen(false);
    }).finally(() => {
      acceptLock.current = false;
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        data-harmonize="true"
        data-harmonize-phase={phase}
        aria-label="Harmonize"
        aria-busy={harmonizePhaseBusy(phase)}
        disabled={disabled}
        title={title}
        onClick={onClick}
        className={`rounded-md border px-2.5 py-1 text-xs ${FOCUS} ${
          disabled
            ? "border-neutral-900 bg-neutral-950 text-neutral-600"
            : "border-neutral-500 bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
        }`}
      >
        {label}
      </button>
      {dialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/70 px-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="harmonize-disclosure-title"
            className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-950 p-4 shadow-xl"
          >
            <h2 id="harmonize-disclosure-title" className="text-sm font-medium text-neutral-100">
              {HARMONIZE_AI_LABEL}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300">
              {HARMONIZE_AI_DISCLOSURE_TEXT}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className={`rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 ${FOCUS}`}
                onClick={() => setDialogOpen(false)}
              >
                Decline
              </button>
              <button
                type="button"
                className={`rounded-md border border-neutral-500 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 ${FOCUS}`}
                onClick={acceptDisclosure}
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
