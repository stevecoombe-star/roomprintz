"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type SaveState = { kind: "idle" | "saving" | "success" | "error"; message?: string };
type GlobalMessage = { kind: "success" | "error"; text: string } | null;

type BetaUsersResponse = {
  users?: Array<{
    id: string;
    email: string | null;
    currentTokenBalance: number;
  }>;
  error?: unknown;
};

type TokenOperationCostRow = {
  operationKey: string;
  adminLabel: string;
  modelVersion: string | null;
  tokenCost: number;
  active: boolean;
  updatedAt: string | null;
};

type TokenOperationCostsResponse = {
  rows?: TokenOperationCostRow[];
  error?: unknown;
};

type TokenAdjustmentResponse = {
  ok?: boolean;
  balanceTokens?: unknown;
  error?: unknown;
};

type TokenLedgerAuditRow = {
  id: string;
  createdAt: string | null;
  userId: string;
  userEmail: string | null;
  eventType: string;
  actionType: string;
  operationKey: string | null;
  tokensDelta: number;
  balanceAfter: number | null;
  chargePhase: string | null;
  operationId: string | null;
  requestId: string | null;
  idempotencyKey: string | null;
  metadataSummary: string;
};

type TokenLedgerAuditResponse = {
  rows?: TokenLedgerAuditRow[];
  totalCount?: number;
  error?: unknown;
};

type RecentAdminAdjustmentRow = {
  id: string;
  createdAt: string | null;
  userId: string;
  userEmail: string | null;
  tokensDelta: number;
  reason: string | null;
  adminUserId: string | null;
};

type RecentAdminAdjustmentsResponse = {
  rows?: RecentAdminAdjustmentRow[];
  error?: unknown;
};

type TokenChargeFailureRow = {
  id: string;
  createdAt: string | null;
  userId: string;
  userEmail: string | null;
  operationKey: string;
  operationId: string | null;
  requestId: string | null;
  idempotencyKey: string | null;
  route: string | null;
  expectedTokens: number | null;
  errorMessage: string | null;
  metadataSummary: string;
};

type TokenChargeFailuresResponse = {
  rows?: TokenChargeFailureRow[];
  totalCount?: number;
  error?: unknown;
};

type RoomReadObservationRow = {
  id: string;
  createdAt: string | null;
  userId: string | null;
  userEmail: string | null;
  model: string;
  workflowType: string;
  actionType: string;
  route: string;
  status: "success" | "failure";
  requestId: string | null;
};

type RoomReadObservationResponse = {
  rows?: RoomReadObservationRow[];
  error?: unknown;
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : fallback;
}

function normalizeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.trunc(value);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.trunc(value).toLocaleString();
}

function formatTokenBalance(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString();
}

function CollapsibleSection(props: {
  title: string;
  description: string;
  defaultExpanded: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(props.defaultExpanded);
  return (
    <section className="token-management-card rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium text-slate-900">{props.title}</h2>
          <p className="mt-1 text-xs text-slate-600">{props.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {props.actions}
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 transition hover:border-emerald-400/80 hover:text-emerald-700"
          >
            {expanded ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>
      {expanded && <div className="token-management-card-content mt-3">{props.children}</div>}
    </section>
  );
}

export default function TokenManagementControls() {
  const [users, setUsers] = useState<BetaUsersResponse["users"]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [globalMessage, setGlobalMessage] = useState<GlobalMessage>(null);

  const [tokenOperationCosts, setTokenOperationCosts] = useState<TokenOperationCostRow[]>([]);
  const [tokenCostInputs, setTokenCostInputs] = useState<
    Record<string, { tokenCost: string; active: boolean; adminLabel: string; modelVersion: string }>
  >({});
  const [tokenCostRowSaveState, setTokenCostRowSaveState] = useState<Record<string, SaveState>>({});
  const [isSavingTokenCostByOperationKey, setIsSavingTokenCostByOperationKey] = useState<
    Record<string, boolean>
  >({});

  const [selectedAdjustmentUserId, setSelectedAdjustmentUserId] = useState<string>("");
  const [adjustmentUserSearchQuery, setAdjustmentUserSearchQuery] = useState<string>("");
  const [adjustmentTokensDeltaInput, setAdjustmentTokensDeltaInput] = useState<string>("");
  const [adjustmentReasonInput, setAdjustmentReasonInput] = useState<string>("");
  const [isSubmittingTokenAdjustment, setIsSubmittingTokenAdjustment] = useState(false);
  const [tokenAdjustmentMessage, setTokenAdjustmentMessage] = useState<GlobalMessage>(null);

  const [tokenLedgerRows, setTokenLedgerRows] = useState<TokenLedgerAuditRow[]>([]);
  const [tokenLedgerTotalCount, setTokenLedgerTotalCount] = useState<number>(0);
  const [isTokenLedgerLoading, setIsTokenLedgerLoading] = useState(false);
  const [tokenLedgerError, setTokenLedgerError] = useState<string | null>(null);
  const [tokenLedgerUserFilter, setTokenLedgerUserFilter] = useState<string>("");
  const [tokenLedgerOperationKeyFilter, setTokenLedgerOperationKeyFilter] = useState<string>("");
  const [tokenLedgerEventTypeFilter, setTokenLedgerEventTypeFilter] = useState<string>("");
  const [tokenLedgerLimitFilter, setTokenLedgerLimitFilter] = useState<string>("50");
  const [tokenLedgerDaysFilter, setTokenLedgerDaysFilter] = useState<string>("14");

  const [recentAdminAdjustments, setRecentAdminAdjustments] = useState<RecentAdminAdjustmentRow[]>([]);
  const [isRecentAdminAdjustmentsLoading, setIsRecentAdminAdjustmentsLoading] = useState(false);
  const [recentAdminAdjustmentsError, setRecentAdminAdjustmentsError] = useState<string | null>(null);

  const [tokenChargeFailureRows, setTokenChargeFailureRows] = useState<TokenChargeFailureRow[]>([]);
  const [tokenChargeFailureTotalCount, setTokenChargeFailureTotalCount] = useState<number>(0);
  const [isTokenChargeFailuresLoading, setIsTokenChargeFailuresLoading] = useState(false);
  const [tokenChargeFailuresError, setTokenChargeFailuresError] = useState<string | null>(null);
  const [tokenChargeFailuresUserFilter, setTokenChargeFailuresUserFilter] = useState<string>("");
  const [tokenChargeFailuresOperationKeyFilter, setTokenChargeFailuresOperationKeyFilter] =
    useState<string>("");
  const [tokenChargeFailuresRouteFilter, setTokenChargeFailuresRouteFilter] = useState<string>("");
  const [tokenChargeFailuresLimitFilter, setTokenChargeFailuresLimitFilter] = useState<string>("50");
  const [tokenChargeFailuresDaysFilter, setTokenChargeFailuresDaysFilter] = useState<string>("14");

  const [roomReadObservationRows, setRoomReadObservationRows] = useState<RoomReadObservationRow[]>([]);
  const [isRoomReadObservationLoading, setIsRoomReadObservationLoading] = useState(false);
  const [roomReadObservationError, setRoomReadObservationError] = useState<string | null>(null);

  const loadBaseData = useCallback(async () => {
    setIsLoadingUsers(true);
    setGlobalMessage(null);
    try {
      const [usersRes, costsRes] = await Promise.all([
        fetch("/api/admin/beta-users", { method: "GET", credentials: "same-origin" }),
        fetch("/api/admin/token-operation-costs", { method: "GET", credentials: "same-origin" }),
      ]);
      const usersPayload = (await usersRes.json().catch(() => ({}))) as BetaUsersResponse;
      const costsPayload = (await costsRes.json().catch(() => ({}))) as TokenOperationCostsResponse;
      if (!usersRes.ok) {
        throw new Error(typeof usersPayload.error === "string" ? usersPayload.error : "Failed to load users.");
      }
      if (!costsRes.ok) {
        throw new Error(typeof costsPayload.error === "string" ? costsPayload.error : "Failed to load costs.");
      }

      const loadedUsers = Array.isArray(usersPayload.users) ? usersPayload.users : [];
      const loadedCosts = Array.isArray(costsPayload.rows) ? costsPayload.rows : [];
      setUsers(loadedUsers);
      setTokenOperationCosts(loadedCosts);
      setTokenCostInputs(
        loadedCosts.reduce<
          Record<string, { tokenCost: string; active: boolean; adminLabel: string; modelVersion: string }>
        >((acc, row) => {
          acc[row.operationKey] = {
            tokenCost: String(normalizeNonNegativeInt(row.tokenCost, 0)),
            active: Boolean(row.active),
            adminLabel: normalizeString(row.adminLabel),
            modelVersion: normalizeString(row.modelVersion),
          };
          return acc;
        }, {})
      );
      setSelectedAdjustmentUserId((current) => {
        if (current && loadedUsers.some((user) => user.id === current)) return current;
        return loadedUsers[0]?.id ?? "";
      });
    } catch (err: unknown) {
      setGlobalMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to load token management data.",
      });
    } finally {
      setIsLoadingUsers(false);
    }
  }, []);

  const loadTokenLedgerAudit = useCallback(async () => {
    setIsTokenLedgerLoading(true);
    setTokenLedgerError(null);
    try {
      const query = new URLSearchParams();
      if (tokenLedgerUserFilter.trim()) query.set("userId", tokenLedgerUserFilter.trim());
      if (tokenLedgerOperationKeyFilter.trim()) query.set("operationKey", tokenLedgerOperationKeyFilter.trim());
      if (tokenLedgerEventTypeFilter.trim()) query.set("eventType", tokenLedgerEventTypeFilter.trim());
      query.set("limit", tokenLedgerLimitFilter.trim() || "50");
      query.set("days", tokenLedgerDaysFilter.trim() || "14");
      const response = await fetch(`/api/admin/token-ledger?${query.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as TokenLedgerAuditResponse;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load.");
      setTokenLedgerRows(Array.isArray(payload.rows) ? payload.rows : []);
      setTokenLedgerTotalCount(normalizeNonNegativeInt(payload.totalCount, 0));
    } catch (err: unknown) {
      setTokenLedgerError(err instanceof Error ? err.message : "Failed to load token ledger audit.");
      setTokenLedgerRows([]);
      setTokenLedgerTotalCount(0);
    } finally {
      setIsTokenLedgerLoading(false);
    }
  }, [
    tokenLedgerDaysFilter,
    tokenLedgerEventTypeFilter,
    tokenLedgerLimitFilter,
    tokenLedgerOperationKeyFilter,
    tokenLedgerUserFilter,
  ]);

  const loadRecentAdminAdjustments = useCallback(async () => {
    setIsRecentAdminAdjustmentsLoading(true);
    setRecentAdminAdjustmentsError(null);
    try {
      const response = await fetch("/api/admin/token-adjustments/recent?limit=30", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as RecentAdminAdjustmentsResponse;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load.");
      setRecentAdminAdjustments(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (err: unknown) {
      setRecentAdminAdjustmentsError(
        err instanceof Error ? err.message : "Failed to load recent admin adjustments."
      );
      setRecentAdminAdjustments([]);
    } finally {
      setIsRecentAdminAdjustmentsLoading(false);
    }
  }, []);

  const loadTokenChargeFailures = useCallback(async () => {
    setIsTokenChargeFailuresLoading(true);
    setTokenChargeFailuresError(null);
    try {
      const query = new URLSearchParams();
      if (tokenChargeFailuresUserFilter.trim()) query.set("userId", tokenChargeFailuresUserFilter.trim());
      if (tokenChargeFailuresOperationKeyFilter.trim()) {
        query.set("operationKey", tokenChargeFailuresOperationKeyFilter.trim());
      }
      if (tokenChargeFailuresRouteFilter.trim()) query.set("route", tokenChargeFailuresRouteFilter.trim());
      query.set("limit", tokenChargeFailuresLimitFilter.trim() || "50");
      query.set("days", tokenChargeFailuresDaysFilter.trim() || "14");
      const response = await fetch(`/api/admin/token-charge-failures?${query.toString()}`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as TokenChargeFailuresResponse;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load.");
      setTokenChargeFailureRows(Array.isArray(payload.rows) ? payload.rows : []);
      setTokenChargeFailureTotalCount(normalizeNonNegativeInt(payload.totalCount, 0));
    } catch (err: unknown) {
      setTokenChargeFailuresError(err instanceof Error ? err.message : "Failed to load token charge failures.");
      setTokenChargeFailureRows([]);
      setTokenChargeFailureTotalCount(0);
    } finally {
      setIsTokenChargeFailuresLoading(false);
    }
  }, [
    tokenChargeFailuresDaysFilter,
    tokenChargeFailuresLimitFilter,
    tokenChargeFailuresOperationKeyFilter,
    tokenChargeFailuresRouteFilter,
    tokenChargeFailuresUserFilter,
  ]);

  const loadRoomReadObservation = useCallback(async () => {
    setIsRoomReadObservationLoading(true);
    setRoomReadObservationError(null);
    try {
      const response = await fetch("/api/admin/room-read-observation?limit=50", {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as RoomReadObservationResponse;
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Failed to load.");
      setRoomReadObservationRows(Array.isArray(payload.rows) ? payload.rows : []);
    } catch (err: unknown) {
      setRoomReadObservationError(err instanceof Error ? err.message : "Failed to load room-read observation.");
      setRoomReadObservationRows([]);
    } finally {
      setIsRoomReadObservationLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    void loadTokenLedgerAudit();
  }, [loadTokenLedgerAudit]);
  useEffect(() => {
    void loadRecentAdminAdjustments();
  }, [loadRecentAdminAdjustments]);
  useEffect(() => {
    void loadTokenChargeFailures();
  }, [loadTokenChargeFailures]);
  useEffect(() => {
    void loadRoomReadObservation();
  }, [loadRoomReadObservation]);

  const adjustmentSelectableUsers = useMemo(() => {
    const query = adjustmentUserSearchQuery.trim().toLocaleLowerCase();
    if (!query) return users ?? [];
    return (users ?? []).filter((user) => {
      const email = (user.email ?? "").toLocaleLowerCase();
      return email.includes(query) || user.id.toLocaleLowerCase().includes(query);
    });
  }, [adjustmentUserSearchQuery, users]);

  const selectedAdjustmentUser = useMemo(
    () => (users ?? []).find((user) => user.id === selectedAdjustmentUserId) ?? null,
    [selectedAdjustmentUserId, users]
  );

  const adjustmentPreviewBalance = useMemo(() => {
    const parsedDelta = Number.parseInt(adjustmentTokensDeltaInput.trim(), 10);
    if (!selectedAdjustmentUser || !Number.isFinite(parsedDelta) || parsedDelta === 0) return null;
    return selectedAdjustmentUser.currentTokenBalance + Math.trunc(parsedDelta);
  }, [adjustmentTokensDeltaInput, selectedAdjustmentUser]);

  const handleSaveTokenOperationCost = async (operationKey: string) => {
    const inputs = tokenCostInputs[operationKey];
    if (!inputs) return;
    const parsedTokenCost = Number.parseInt(inputs.tokenCost.trim(), 10);
    if (!Number.isFinite(parsedTokenCost) || parsedTokenCost < 0) {
      setTokenCostRowSaveState((prev) => ({
        ...prev,
        [operationKey]: { kind: "error", message: "Token cost must be an integer >= 0." },
      }));
      return;
    }

    setIsSavingTokenCostByOperationKey((prev) => ({ ...prev, [operationKey]: true }));
    setTokenCostRowSaveState((prev) => ({ ...prev, [operationKey]: { kind: "saving" } }));
    try {
      const response = await fetch(`/api/admin/token-operation-costs/${encodeURIComponent(operationKey)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          tokenCost: parsedTokenCost,
          active: inputs.active,
          adminLabel: inputs.adminLabel.trim() || null,
          modelVersion: inputs.modelVersion.trim() || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        row?: TokenOperationCostRow;
        error?: unknown;
      };
      if (!response.ok || !payload.row) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to update token operation cost.");
      }
      const updatedRow = payload.row;
      setTokenOperationCosts((prev) => prev.map((row) => (row.operationKey === operationKey ? updatedRow : row)));
      setTokenCostInputs((prev) => ({
        ...prev,
        [operationKey]: {
          tokenCost: String(normalizeNonNegativeInt(updatedRow.tokenCost, 0)),
          active: Boolean(updatedRow.active),
          adminLabel: normalizeString(updatedRow.adminLabel),
          modelVersion: normalizeString(updatedRow.modelVersion),
        },
      }));
      setTokenCostRowSaveState((prev) => ({ ...prev, [operationKey]: { kind: "success", message: "Saved." } }));
    } catch (err: unknown) {
      setTokenCostRowSaveState((prev) => ({
        ...prev,
        [operationKey]: {
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to update token operation cost.",
        },
      }));
    } finally {
      setIsSavingTokenCostByOperationKey((prev) => ({ ...prev, [operationKey]: false }));
    }
  };

  const handleSubmitTokenAdjustment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTokenAdjustmentMessage(null);
    const userId = selectedAdjustmentUserId.trim();
    if (!userId) return setTokenAdjustmentMessage({ kind: "error", text: "Select a user first." });
    const tokensDelta = Number.parseInt(adjustmentTokensDeltaInput.trim(), 10);
    if (!Number.isFinite(tokensDelta) || tokensDelta === 0) {
      return setTokenAdjustmentMessage({ kind: "error", text: "Token adjustment must be a non-zero integer." });
    }
    const reason = adjustmentReasonInput.trim();
    if (!reason) return setTokenAdjustmentMessage({ kind: "error", text: "Reason is required." });

    setIsSubmittingTokenAdjustment(true);
    try {
      const idempotencyKey = `${userId}:${Date.now()}:${crypto.randomUUID()}`;
      const response = await fetch("/api/admin/token-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId, tokensDelta, reason, idempotencyKey }),
      });
      const payload = (await response.json().catch(() => ({}))) as TokenAdjustmentResponse;
      if (!response.ok || payload.ok !== true) {
        throw new Error(typeof payload.error === "string" ? payload.error : "Failed to apply token adjustment.");
      }
      const updatedBalance = normalizeInt(payload.balanceTokens, Number.NaN);
      if (Number.isFinite(updatedBalance)) {
        setUsers((prev) => (prev ?? []).map((user) => (user.id === userId ? { ...user, currentTokenBalance: updatedBalance } : user)));
      }
      setAdjustmentTokensDeltaInput("");
      setAdjustmentReasonInput("");
      setTokenAdjustmentMessage({
        kind: "success",
        text: `Adjustment applied. New balance: ${formatTokenBalance(Number.isFinite(updatedBalance) ? updatedBalance : 0)} tokens.`,
      });
      await Promise.all([loadRecentAdminAdjustments(), loadTokenLedgerAudit()]);
    } catch (err: unknown) {
      setTokenAdjustmentMessage({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to apply token adjustment.",
      });
    } finally {
      setIsSubmittingTokenAdjustment(false);
    }
  };

  return (
    <main className="token-management-surface min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Token Management</h1>
              <p className="text-sm text-slate-300">Operation costs, adjustments, and token reconciliation tooling.</p>
            </div>
            <Link
              href="/admin"
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
            >
              Back to Admin
            </Link>
          </div>
          {globalMessage && (
            <p className={`text-xs ${globalMessage.kind === "success" ? "text-emerald-300" : "text-rose-300"}`}>
              {globalMessage.text}
            </p>
          )}
        </header>

        <CollapsibleSection
          title="Token Operation Costs"
          description="Manage operation-level token pricing used by the token cost table."
          defaultExpanded={false}
          actions={
            <button
              type="button"
              onClick={() => void loadBaseData()}
              disabled={isLoadingUsers}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
            >
              {isLoadingUsers ? "Refreshing..." : "Refresh"}
            </button>
          }
        >
          <div className="space-y-4">
            {tokenOperationCosts.length === 0 && <p className="text-xs text-slate-400">No token operation costs found.</p>}
            {tokenOperationCosts.map((row) => {
              const inputs = tokenCostInputs[row.operationKey] ?? {
                tokenCost: String(row.tokenCost),
                active: row.active,
                adminLabel: row.adminLabel,
                modelVersion: row.modelVersion ?? "",
              };
              const rowState = tokenCostRowSaveState[row.operationKey] ?? { kind: "idle" as const };
              const isSaving = Boolean(isSavingTokenCostByOperationKey[row.operationKey]);
              return (
                <article key={row.operationKey} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="grid gap-3 md:grid-cols-6">
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <span className="text-xs font-medium text-slate-700">Admin label</span>
                      <input
                        type="text"
                        value={inputs.adminLabel}
                        onChange={(event) =>
                          setTokenCostInputs((prev) => ({
                            ...prev,
                            [row.operationKey]: { ...inputs, adminLabel: event.target.value },
                          }))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-700">Operation key</span>
                      <input
                        type="text"
                        value={row.operationKey}
                        readOnly
                        className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1.5 text-sm text-slate-700"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-700">Model version</span>
                      <input
                        type="text"
                        value={inputs.modelVersion}
                        onChange={(event) =>
                          setTokenCostInputs((prev) => ({
                            ...prev,
                            [row.operationKey]: { ...inputs, modelVersion: event.target.value },
                          }))
                        }
                        placeholder="optional"
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-700">Token cost</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={inputs.tokenCost}
                        onChange={(event) =>
                          setTokenCostInputs((prev) => ({
                            ...prev,
                            [row.operationKey]: { ...inputs, tokenCost: event.target.value },
                          }))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      />
                    </label>
                    <label className="flex h-full items-end gap-2 pb-1">
                      <input
                        type="checkbox"
                        checked={inputs.active}
                        onChange={(event) =>
                          setTokenCostInputs((prev) => ({
                            ...prev,
                            [row.operationKey]: { ...inputs, active: event.target.checked },
                          }))
                        }
                        className="h-4 w-4 rounded border-slate-300 bg-white text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-slate-700">Active</span>
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSaveTokenOperationCost(row.operationKey)}
                      disabled={isSaving}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 transition hover:border-emerald-400/80 hover:text-emerald-700 disabled:opacity-60"
                    >
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                    <span className="text-xs text-slate-500">Updated: {formatDate(row.updatedAt)}</span>
                    {rowState.kind === "success" && <span className="text-xs text-emerald-700">{rowState.message ?? "Saved."}</span>}
                    {rowState.kind === "error" && <span className="text-xs text-rose-700">{rowState.message ?? "Save failed."}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="User Token Adjustments"
          description="Apply signed token adjustments through the admin adjustment RPC (positive adds, negative subtracts)."
          defaultExpanded
        >
          <form className="grid gap-3 md:grid-cols-4" onSubmit={handleSubmitTokenAdjustment}>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Search user</span>
              <input
                type="text"
                value={adjustmentUserSearchQuery}
                onChange={(event) => setAdjustmentUserSearchQuery(event.target.value)}
                placeholder="Search email or user id..."
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-slate-400">User</span>
              <select
                value={selectedAdjustmentUserId}
                onChange={(event) => setSelectedAdjustmentUserId(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              >
                {adjustmentSelectableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email ?? user.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Token adjustment</span>
              <input
                type="number"
                step={1}
                value={adjustmentTokensDeltaInput}
                onChange={(event) => setAdjustmentTokensDeltaInput(event.target.value)}
                placeholder="+50 or -25"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <label className="flex flex-col gap-1 md:col-span-1">
              <span className="text-xs text-slate-400">Reason</span>
              <input
                type="text"
                value={adjustmentReasonInput}
                onChange={(event) => setAdjustmentReasonInput(event.target.value)}
                placeholder="Required"
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>
            <div className="md:col-span-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isSubmittingTokenAdjustment}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
              >
                {isSubmittingTokenAdjustment ? "Applying..." : "Apply Adjustment"}
              </button>
              <span className="text-xs text-slate-400">
                Current balance: {selectedAdjustmentUser ? formatTokenBalance(selectedAdjustmentUser.currentTokenBalance) : "0"} tokens
              </span>
              {adjustmentPreviewBalance !== null && (
                <span className="text-xs text-slate-400">Preview balance: {formatTokenBalance(adjustmentPreviewBalance)} tokens</span>
              )}
            </div>
          </form>
          {tokenAdjustmentMessage && (
            <p className={`mt-3 text-xs ${tokenAdjustmentMessage.kind === "success" ? "text-emerald-300" : "text-rose-300"}`}>
              {tokenAdjustmentMessage.text}
            </p>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Token Ledger Audit"
          description="Reconciliation view for recent token ledger activity and idempotency context."
          defaultExpanded={false}
          actions={
            <button
              type="button"
              onClick={() => void loadTokenLedgerAudit()}
              disabled={isTokenLedgerLoading}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
            >
              {isTokenLedgerLoading ? "Refreshing..." : "Refresh"}
            </button>
          }
        >
          <div className="grid gap-3 md:grid-cols-6">
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">User</span><select value={tokenLedgerUserFilter} onChange={(event) => setTokenLedgerUserFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400"><option value="">All users</option>{(users ?? []).map((user) => <option key={user.id} value={user.id}>{user.email ?? user.id}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Operation key</span><input type="text" value={tokenLedgerOperationKeyFilter} onChange={(event) => setTokenLedgerOperationKeyFilter(event.target.value)} placeholder="e.g. FULL_VIBE" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Event type</span><select value={tokenLedgerEventTypeFilter} onChange={(event) => setTokenLedgerEventTypeFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400"><option value="">All events</option><option value="spend">spend</option><option value="grant">grant</option><option value="admin_grant">admin_grant</option><option value="admin_debit">admin_debit</option></select></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Recent days</span><input type="number" min={0} max={365} value={tokenLedgerDaysFilter} onChange={(event) => setTokenLedgerDaysFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Limit</span><input type="number" min={1} max={200} value={tokenLedgerLimitFilter} onChange={(event) => setTokenLedgerLimitFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <div className="flex items-end"><button type="button" onClick={() => void loadTokenLedgerAudit()} disabled={isTokenLedgerLoading} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60">Apply Filters</button></div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Showing {tokenLedgerRows.length} of {tokenLedgerTotalCount} rows.</p>
          {tokenLedgerError && <p className="mt-2 text-xs text-rose-300">{tokenLedgerError}</p>}
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs text-slate-300"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Created</th><th className="px-2 py-1">User</th><th className="px-2 py-1">Event</th><th className="px-2 py-1">Action</th><th className="px-2 py-1">Operation</th><th className="px-2 py-1">Delta</th><th className="px-2 py-1">Balance</th><th className="px-2 py-1">Phase</th><th className="px-2 py-1">Operation ID</th><th className="px-2 py-1">Request ID</th><th className="px-2 py-1">Idempotency Key</th><th className="px-2 py-1">Metadata</th></tr></thead><tbody>{tokenLedgerRows.map((row) => <tr key={row.id} className="border-t border-slate-800 align-top"><td className="px-2 py-1">{formatDate(row.createdAt)}</td><td className="px-2 py-1"><p>{row.userEmail ?? "—"}</p><p className="text-[11px] text-slate-500">{row.userId}</p></td><td className="px-2 py-1">{row.eventType}</td><td className="px-2 py-1">{row.actionType}</td><td className="px-2 py-1">{row.operationKey ?? "—"}</td><td className="px-2 py-1">{formatMetric(row.tokensDelta)}</td><td className="px-2 py-1">{typeof row.balanceAfter === "number" ? formatMetric(row.balanceAfter) : "—"}</td><td className="px-2 py-1">{row.chargePhase ?? "—"}</td><td className="px-2 py-1">{row.operationId ?? "—"}</td><td className="px-2 py-1">{row.requestId ?? "—"}</td><td className="px-2 py-1">{row.idempotencyKey ?? "—"}</td><td className="px-2 py-1 max-w-xs truncate" title={row.metadataSummary}>{row.metadataSummary || "—"}</td></tr>)}{tokenLedgerRows.length === 0 && <tr><td className="px-2 py-3 text-slate-500" colSpan={12}>No token ledger rows for current filters.</td></tr>}</tbody></table></div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Recent Admin Adjustments"
          description="Latest manual token grants/debits with reason and acting admin id."
          defaultExpanded={false}
          actions={<button type="button" onClick={() => void loadRecentAdminAdjustments()} disabled={isRecentAdminAdjustmentsLoading} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60">{isRecentAdminAdjustmentsLoading ? "Refreshing..." : "Refresh"}</button>}
        >
          {recentAdminAdjustmentsError && <p className="mt-2 text-xs text-rose-300">{recentAdminAdjustmentsError}</p>}
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs text-slate-300"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Created</th><th className="px-2 py-1">User</th><th className="px-2 py-1">Delta</th><th className="px-2 py-1">Reason</th><th className="px-2 py-1">Admin User ID</th></tr></thead><tbody>{recentAdminAdjustments.map((row) => <tr key={row.id} className="border-t border-slate-800 align-top"><td className="px-2 py-1">{formatDate(row.createdAt)}</td><td className="px-2 py-1"><p>{row.userEmail ?? "—"}</p><p className="text-[11px] text-slate-500">{row.userId}</p></td><td className="px-2 py-1">{formatMetric(row.tokensDelta)}</td><td className="px-2 py-1">{row.reason ?? "—"}</td><td className="px-2 py-1">{row.adminUserId ?? "—"}</td></tr>)}{recentAdminAdjustments.length === 0 && <tr><td className="px-2 py-3 text-slate-500" colSpan={5}>No recent admin adjustments.</td></tr>}</tbody></table></div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Token Charge Failures"
          description="Read-only reconciliation view for successful operations where post-success token debit failed."
          defaultExpanded={false}
          actions={<button type="button" onClick={() => void loadTokenChargeFailures()} disabled={isTokenChargeFailuresLoading} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60">{isTokenChargeFailuresLoading ? "Refreshing..." : "Refresh"}</button>}
        >
          <div className="grid gap-3 md:grid-cols-6">
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">User</span><select value={tokenChargeFailuresUserFilter} onChange={(event) => setTokenChargeFailuresUserFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400"><option value="">All users</option>{(users ?? []).map((user) => <option key={user.id} value={user.id}>{user.email ?? user.id}</option>)}</select></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Operation key</span><input type="text" value={tokenChargeFailuresOperationKeyFilter} onChange={(event) => setTokenChargeFailuresOperationKeyFilter(event.target.value)} placeholder="e.g. FULL_VIBE" className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Route</span><input type="text" value={tokenChargeFailuresRouteFilter} onChange={(event) => setTokenChargeFailuresRouteFilter(event.target.value)} placeholder="/api/vibode/..." className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Recent days</span><input type="number" min={0} max={365} value={tokenChargeFailuresDaysFilter} onChange={(event) => setTokenChargeFailuresDaysFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-slate-400">Limit</span><input type="number" min={1} max={200} value={tokenChargeFailuresLimitFilter} onChange={(event) => setTokenChargeFailuresLimitFilter(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs outline-none focus:border-emerald-400" /></label>
            <div className="flex items-end"><button type="button" onClick={() => void loadTokenChargeFailures()} disabled={isTokenChargeFailuresLoading} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60">Apply Filters</button></div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Showing {tokenChargeFailureRows.length} of {tokenChargeFailureTotalCount} rows.</p>
          {tokenChargeFailuresError && <p className="mt-2 text-xs text-rose-300">{tokenChargeFailuresError}</p>}
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs text-slate-300"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Created</th><th className="px-2 py-1">User</th><th className="px-2 py-1">Operation</th><th className="px-2 py-1">Expected Tokens</th><th className="px-2 py-1">Route</th><th className="px-2 py-1">Operation ID</th><th className="px-2 py-1">Request ID</th><th className="px-2 py-1">Idempotency Key</th><th className="px-2 py-1">Error</th><th className="px-2 py-1">Metadata</th></tr></thead><tbody>{tokenChargeFailureRows.map((row) => <tr key={row.id} className="border-t border-slate-800 align-top"><td className="px-2 py-1">{formatDate(row.createdAt)}</td><td className="px-2 py-1"><p>{row.userEmail ?? "—"}</p><p className="text-[11px] text-slate-500">{row.userId}</p></td><td className="px-2 py-1">{row.operationKey}</td><td className="px-2 py-1">{typeof row.expectedTokens === "number" ? formatMetric(row.expectedTokens) : "—"}</td><td className="px-2 py-1">{row.route ?? "—"}</td><td className="px-2 py-1">{row.operationId ?? "—"}</td><td className="px-2 py-1">{row.requestId ?? "—"}</td><td className="px-2 py-1">{row.idempotencyKey ?? "—"}</td><td className="px-2 py-1">{row.errorMessage ?? "—"}</td><td className="px-2 py-1 max-w-xs truncate" title={row.metadataSummary}>{row.metadataSummary || "—"}</td></tr>)}{tokenChargeFailureRows.length === 0 && <tr><td className="px-2 py-3 text-slate-500" colSpan={10}>No token charge failures for current filters.</td></tr>}</tbody></table></div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Room-Read Observation (No Charge)"
          description="Monitoring-only feed from vibode_gemini_usage_events for room-read/object-detection activity."
          defaultExpanded={false}
          actions={<button type="button" onClick={() => void loadRoomReadObservation()} disabled={isRoomReadObservationLoading} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60">{isRoomReadObservationLoading ? "Refreshing..." : "Refresh"}</button>}
        >
          {roomReadObservationError && <p className="mt-2 text-xs text-rose-300">{roomReadObservationError}</p>}
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs text-slate-300"><thead className="text-[11px] uppercase tracking-wide text-slate-400"><tr><th className="px-2 py-1">Created</th><th className="px-2 py-1">User</th><th className="px-2 py-1">Model</th><th className="px-2 py-1">Workflow</th><th className="px-2 py-1">Action</th><th className="px-2 py-1">Route</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Request ID</th></tr></thead><tbody>{roomReadObservationRows.map((row) => <tr key={row.id} className="border-t border-slate-800 align-top"><td className="px-2 py-1">{formatDate(row.createdAt)}</td><td className="px-2 py-1"><p>{row.userEmail ?? "—"}</p><p className="text-[11px] text-slate-500">{row.userId ?? "anonymous"}</p></td><td className="px-2 py-1">{row.model}</td><td className="px-2 py-1">{row.workflowType}</td><td className="px-2 py-1">{row.actionType}</td><td className="px-2 py-1">{row.route}</td><td className="px-2 py-1">{row.status}</td><td className="px-2 py-1">{row.requestId ?? "—"}</td></tr>)}{roomReadObservationRows.length === 0 && <tr><td className="px-2 py-3 text-slate-500" colSpan={8}>No room-read/object-detection events found in current sample.</td></tr>}</tbody></table></div>
        </CollapsibleSection>
      </div>
      <style jsx global>{`
        .token-management-card .bg-slate-950,
        .token-management-card .bg-slate-950\\/60,
        .token-management-card .bg-slate-900,
        .token-management-card .bg-slate-900\\/70 {
          background-color: #ffffff;
        }

        .token-management-card .border-slate-700,
        .token-management-card .border-slate-800 {
          border-color: #cbd5e1;
        }

        .token-management-card .text-slate-100,
        .token-management-card .text-slate-200,
        .token-management-card .text-slate-300 {
          color: #0f172a;
        }

        .token-management-card .text-slate-400 {
          color: #334155;
        }

        .token-management-card .text-slate-500 {
          color: #475569;
        }

        .token-management-card input:not([type="checkbox"]):not([type="radio"]),
        .token-management-card select,
        .token-management-card textarea {
          background-color: #ffffff;
          color: #0f172a;
          border-color: #cbd5e1;
        }

        .token-management-card input:not([type="checkbox"]):not([type="radio"])::placeholder,
        .token-management-card textarea::placeholder {
          color: #64748b;
        }

        .token-management-card input:not([type="checkbox"]):not([type="radio"]):focus,
        .token-management-card select:focus,
        .token-management-card textarea:focus {
          border-color: #34d399;
          box-shadow: 0 0 0 1px #34d399;
          outline: none;
        }

        .token-management-card input:disabled,
        .token-management-card select:disabled,
        .token-management-card textarea:disabled {
          background-color: #f8fafc;
        }
      `}</style>
    </main>
  );
}
