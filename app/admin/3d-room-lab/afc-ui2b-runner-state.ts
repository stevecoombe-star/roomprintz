"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type AfcUi2bStudyMode = "original_only" | "empty_only";
export type AfcUi2bPackage = Readonly<{
  packageId: string; roomId: string;
  receipt: Readonly<{ fileName: string; sha256: string }>;
  manifest: Readonly<{ fileName: string; sha256: string }>;
  original: Readonly<{ sha256: string }>;
  emptyRoomAssist: Readonly<{ sha256: string }>;
  sharedContextDigest: string;
}>;
export type AfcUi2bResult = Readonly<Record<string, unknown>> & Readonly<{ status: string }>;

const RUN_ROUTE = "/api/admin/3d-room-lab/afc-ui2b/proposal-run";
const INVENTORY_ROUTE = "/api/admin/3d-room-lab/afc-ui2b/proposal-runs";

export function createAfcUi2bRequestGuard() {
  let generation = 0;
  return Object.freeze({ begin: () => ++generation, invalidate: () => ++generation, isCurrent: (candidate: number) => generation === candidate });
}
export function afcUi2bIdentity(selectedPackage: AfcUi2bPackage | null, studyMode: AfcUi2bStudyMode | ""): string | null {
  return selectedPackage && studyMode ? `${selectedPackage.roomId}\n${selectedPackage.packageId}\n${selectedPackage.receipt.sha256}\n${studyMode}` : null;
}
export function buildAfcUi2bProposalRunRequest(
  operation: "validate" | "execute",
  selectedPackage: AfcUi2bPackage,
  studyMode: AfcUi2bStudyMode,
) {
  return Object.freeze({
    contractVersion: "afc-ui2b-proposal-run-request/v1" as const, operation, roomLabel: selectedPackage.roomId,
    packageSelector: Object.freeze({
      packageId: selectedPackage.packageId, receiptFileName: selectedPackage.receipt.fileName, receiptSha256: selectedPackage.receipt.sha256,
    }),
    studyMode,
    ...(operation === "execute" ? { executeCapture: true as const, executeLiveProviderCall: true as const } : {}),
  });
}
export function buildAfcUi2bPackageInventoryUrl(roomId: string): string {
  return `/api/admin/3d-room-lab/afc-ui2a/packages?roomLabel=${encodeURIComponent(roomId)}`;
}
export function buildAfcUi2bRunInventoryUrl(roomId: string, selectedPackage: AfcUi2bPackage | null, studyMode: AfcUi2bStudyMode | ""): string {
  const search = new URLSearchParams({ roomLabel: roomId });
  if (selectedPackage) search.set("packageId", selectedPackage.packageId);
  if (studyMode) search.set("studyMode", studyMode);
  return `${INVENTORY_ROUTE}?${search.toString()}`;
}
function validPackage(value: unknown): value is AfcUi2bPackage {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AfcUi2bPackage>;
  return typeof item.packageId === "string" && typeof item.roomId === "string" && !!item.receipt &&
    typeof item.receipt.fileName === "string" && typeof item.receipt.sha256 === "string" &&
    !!item.manifest && typeof item.manifest.fileName === "string" && typeof item.manifest.sha256 === "string" &&
    !!item.original && typeof item.original.sha256 === "string" && !!item.emptyRoomAssist &&
    typeof item.emptyRoomAssist.sha256 === "string" && typeof item.sharedContextDigest === "string";
}
function result(value: unknown): AfcUi2bResult | null {
  return !!value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string" ? value as AfcUi2bResult : null;
}

export function useAfcUi2bRunnerState(enabled: boolean, roomId: string) {
  const [packages, setPackages] = useState<readonly AfcUi2bPackage[]>([]);
  const [packageInventoryStatus, setPackageInventoryStatus] = useState<"idle" | "loading" | "loaded" | "failure">("idle");
  const [invalidPackageCandidateCount, setInvalidPackageCandidateCount] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState<AfcUi2bPackage | null>(null);
  const [studyMode, setStudyMode] = useState<AfcUi2bStudyMode | "">("");
  const [validationStatus, setValidationStatus] = useState<"idle" | "validating" | "validated" | "failure">("idle");
  const [executionStatus, setExecutionStatus] = useState<"idle" | "executing" | "completed" | "failure">("idle");
  const [lastValidation, setLastValidation] = useState<AfcUi2bResult | null>(null);
  const [lastRun, setLastRun] = useState<AfcUi2bResult | null>(null);
  const [runInventoryStatus, setRunInventoryStatus] = useState<"idle" | "loading" | "loaded" | "failure">("idle");
  const [runInventory, setRunInventory] = useState<readonly AfcUi2bResult[]>([]);
  const [invalidRunCandidateCount, setInvalidRunCandidateCount] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [viewerHandoffReceipt, setViewerHandoffReceipt] = useState<string | null>(null);
  const packageGuard = useRef(createAfcUi2bRequestGuard());
  const validationGuard = useRef(createAfcUi2bRequestGuard());
  const executionGuard = useRef(createAfcUi2bRequestGuard());
  const runGuard = useRef(createAfcUi2bRequestGuard());
  const invalidateRunState = useCallback(() => {
    validationGuard.current.invalidate();
    executionGuard.current.invalidate();
    runGuard.current.invalidate();
    setValidationStatus("idle");
    setExecutionStatus("idle");
    setLastValidation(null);
    setLastRun(null);
    setViewerHandoffReceipt(null);
    setRunInventory([]);
    setRunInventoryStatus("idle");
    setInvalidRunCandidateCount(0);
    setFailure(null);
  }, []);
  useEffect(() => () => {
    packageGuard.current.invalidate(); validationGuard.current.invalidate(); executionGuard.current.invalidate(); runGuard.current.invalidate();
  }, []);

  const clear = useCallback(() => {
    packageGuard.current.invalidate();
    setPackages([]);
    setPackageInventoryStatus("idle");
    setInvalidPackageCandidateCount(0);
    setSelectedPackage(null);
    setStudyMode("");
    setRunInventory([]);
    setRunInventoryStatus("idle");
    setInvalidRunCandidateCount(0);
    invalidateRunState();
  }, [invalidateRunState]);
  useEffect(() => {
    if (enabled) return;
    packageGuard.current.invalidate();
    validationGuard.current.invalidate();
    executionGuard.current.invalidate();
    runGuard.current.invalidate();
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) clear(); });
    return () => { cancelled = true; };
  }, [clear, enabled]);
  const refreshPackages = useCallback(async () => {
    if (!enabled || !roomId) return;
    const generation = packageGuard.current.begin();
    setPackageInventoryStatus("loading");
    try {
      const response = await fetch(buildAfcUi2bPackageInventoryUrl(roomId), { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!packageGuard.current.isCurrent(generation)) return;
      const entries = body && typeof body === "object" ? (body as { packages?: unknown }).packages : null;
      if (!response.ok || !Array.isArray(entries)) {
        setPackageInventoryStatus("failure");
        return;
      }
      const accepted = entries.filter(validPackage);
      setPackages(accepted);
      setInvalidPackageCandidateCount(typeof (body as { invalidCandidateCount?: unknown }).invalidCandidateCount === "number" ? (body as { invalidCandidateCount: number }).invalidCandidateCount : entries.length - accepted.length);
      setPackageInventoryStatus("loaded");
    } catch {
      if (packageGuard.current.isCurrent(generation)) setPackageInventoryStatus("failure");
    }
  }, [enabled, roomId]);
  const selectPackage = useCallback((value: AfcUi2bPackage | null) => {
    invalidateRunState();
    setSelectedPackage(value);
  }, [invalidateRunState]);
  const selectStudyMode = useCallback((value: AfcUi2bStudyMode | "") => {
    invalidateRunState();
    setStudyMode(value);
  }, [invalidateRunState]);
  const validate = useCallback(async () => {
    if (!enabled || !selectedPackage || !studyMode || validationStatus === "validating" || executionStatus === "executing") return;
    const selectedIdentity = afcUi2bIdentity(selectedPackage, studyMode);
    const generation = validationGuard.current.begin();
    setValidationStatus("validating"); setExecutionStatus("idle"); setLastValidation(null); setLastRun(null); setViewerHandoffReceipt(null); setFailure(null);
    try {
      const response = await fetch(RUN_ROUTE, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAfcUi2bProposalRunRequest("validate", selectedPackage, studyMode)),
      });
      const body = result(await response.json().catch(() => null));
      if (!validationGuard.current.isCurrent(generation) || selectedIdentity !== afcUi2bIdentity(selectedPackage, studyMode)) return;
      if (response.ok && body?.status === "run_validated") {
        setLastValidation(body); setValidationStatus("validated");
      } else {
        setValidationStatus("failure"); setFailure(typeof body?.message === "string" ? body.message : "Proposal-run validation failed.");
      }
    } catch {
      if (validationGuard.current.isCurrent(generation)) { setValidationStatus("failure"); setFailure("Proposal-run validation could not be completed."); }
    }
  }, [enabled, executionStatus, selectedPackage, studyMode, validationStatus]);
  const execute = useCallback(async () => {
    if (!enabled || !selectedPackage || !studyMode || validationStatus !== "validated" || executionStatus === "executing") return;
    const selectedIdentity = afcUi2bIdentity(selectedPackage, studyMode);
    const generation = executionGuard.current.begin();
    setExecutionStatus("executing"); setLastRun(null); setViewerHandoffReceipt(null); setFailure(null);
    try {
      const response = await fetch(RUN_ROUTE, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildAfcUi2bProposalRunRequest("execute", selectedPackage, studyMode)),
      });
      const body = result(await response.json().catch(() => null));
      if (!executionGuard.current.isCurrent(generation) || selectedIdentity !== afcUi2bIdentity(selectedPackage, studyMode)) return;
      if (response.ok && body?.status === "run_completed") {
        setLastRun(body); setExecutionStatus("completed"); setValidationStatus("idle");
      } else {
        setExecutionStatus("failure"); setValidationStatus("idle"); setFailure(typeof body?.message === "string" ? body.message : "The live proposal run failed.");
      }
    } catch {
      if (executionGuard.current.isCurrent(generation)) { setExecutionStatus("failure"); setValidationStatus("idle"); setFailure("The live proposal run could not be completed."); }
    }
  }, [enabled, executionStatus, selectedPackage, studyMode, validationStatus]);
  const refreshRuns = useCallback(async () => {
    if (!enabled || !roomId) return;
    const generation = runGuard.current.begin();
    setRunInventoryStatus("loading");
    try {
      const response = await fetch(buildAfcUi2bRunInventoryUrl(roomId, selectedPackage, studyMode), { cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!runGuard.current.isCurrent(generation)) return;
      const entries = body && typeof body === "object" ? (body as { runs?: unknown }).runs : null;
      if (!response.ok || !Array.isArray(entries)) { setRunInventoryStatus("failure"); return; }
      const accepted = entries.filter(result);
      setRunInventory(accepted);
      setInvalidRunCandidateCount(typeof (body as { invalidCandidateCount?: unknown }).invalidCandidateCount === "number" ? (body as { invalidCandidateCount: number }).invalidCandidateCount : entries.length - accepted.length);
      setRunInventoryStatus("loaded");
    } catch {
      if (runGuard.current.isCurrent(generation)) setRunInventoryStatus("failure");
    }
  }, [enabled, roomId, selectedPackage, studyMode]);
  const prepareViewerHandoff = useCallback(() => {
    const proposal = lastRun?.proposal;
    if (!proposal || typeof proposal !== "object" || typeof (proposal as { receiptFileName?: unknown }).receiptFileName !== "string") return;
    setViewerHandoffReceipt((proposal as { receiptFileName: string }).receiptFileName);
  }, [lastRun]);
  const requestInFlight = validationStatus === "validating" || executionStatus === "executing";
  return useMemo(() => ({
    packages, packageInventoryStatus, invalidPackageCandidateCount, selectedPackage, studyMode, validationStatus, executionStatus,
    lastValidation, lastRun, runInventoryStatus, runInventory, invalidRunCandidateCount, failure, viewerHandoffReceipt, requestInFlight,
    refreshPackages, selectPackage, selectStudyMode, validate, execute, refreshRuns, prepareViewerHandoff, clear,
  }), [packages, packageInventoryStatus, invalidPackageCandidateCount, selectedPackage, studyMode, validationStatus, executionStatus, lastValidation, lastRun, runInventoryStatus, runInventory, invalidRunCandidateCount, failure, viewerHandoffReceipt, requestInFlight, refreshPackages, selectPackage, selectStudyMode, validate, execute, refreshRuns, prepareViewerHandoff, clear]);
}
