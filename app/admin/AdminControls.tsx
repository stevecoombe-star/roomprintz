"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type BetaSettingsResponse = {
  settings?: {
    betaAccessCode?: unknown;
    defaultTopupLimit?: unknown;
    updatedAt?: unknown;
  };
  error?: unknown;
};

type BetaUsersResponse = {
  users?: Array<{
    id: string;
    email: string | null;
    createdAt: string | null;
    lastSignInAt: string | null;
    topupsUsed: number;
    effectiveTopupLimit: number;
    betaTopupLimitOverride: number | null;
    currentTokenBalance: number;
  }>;
  defaultTopupLimit?: unknown;
  error?: unknown;
};

type UserAuditData = {
  userId: string;
  email: string | null;
  joinedAt: string | null;
  lastSignInAt: string | null;
  currentTokenBalance: number;
  effectiveTopupLimit: number;
  betaTopupLimitOverride: number | null;
  topupsUsed: number;
  counts: {
    vibodeRoomsOwned: number;
    legacyRoomsOwned: number;
    myFurnitureItemsOwned: number;
    tokenLedgerRows: number;
    betaUserSettingsRows: number;
  };
  optionalAuditCounts: Array<{
    label: string;
    table: string;
    count: number;
  }>;
  storageAudit: {
    exactPaths: Array<{
      bucket: string;
      path: string;
      source: "database" | "storage_listing";
    }>;
    estimatedPaths: Array<{
      bucket: string;
      path: string;
      reason: string;
      fileCount: number | null;
    }>;
  };
};

type UserAuditResponse = {
  audit?: UserAuditData;
  error?: unknown;
};

type DeleteUserResponse = {
  success?: boolean;
  deletedStorageFiles?: unknown;
  skippedStorageFiles?: unknown;
  deletedRowsByTable?: unknown;
  authUserDeleted?: unknown;
  error?: unknown;
};

type GlobalMessage = {
  kind: "success" | "error";
  text: string;
} | null;

type SaveState = {
  kind: "idle" | "saving" | "success" | "error";
  message?: string;
};

type AuditLoadState = {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
};

type UserSortOption = "latest_joined" | "last_sign_in" | "email";

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : fallback;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString();
}

function formatTokenBalance(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString();
}

export default function AdminControls() {
  const [isLoading, setIsLoading] = useState(true);
  const [globalMessage, setGlobalMessage] = useState<GlobalMessage>(null);

  const [betaAccessCode, setBetaAccessCode] = useState("");
  const [defaultTopupLimitInput, setDefaultTopupLimitInput] = useState("1");
  const [settingsUpdatedAt, setSettingsUpdatedAt] = useState<string | null>(null);
  const [isSavingGlobal, setIsSavingGlobal] = useState(false);

  const [users, setUsers] = useState<BetaUsersResponse["users"]>([]);
  const [overrideInputs, setOverrideInputs] = useState<Record<string, string>>({});
  const [rowSaveState, setRowSaveState] = useState<Record<string, SaveState>>({});
  const [isUserOverridesExpanded, setIsUserOverridesExpanded] = useState(false);
  const [userSortBy, setUserSortBy] = useState<UserSortOption>("latest_joined");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedUserAudits, setExpandedUserAudits] = useState<Record<string, boolean>>({});
  const [expandedUserStoragePaths, setExpandedUserStoragePaths] = useState<Record<string, boolean>>({});
  const [auditLoadState, setAuditLoadState] = useState<Record<string, AuditLoadState>>({});
  const [auditCacheByUserId, setAuditCacheByUserId] = useState<Record<string, UserAuditData>>({});
  const [deleteTargetUserId, setDeleteTargetUserId] = useState<string | null>(null);
  const [deleteConfirmEmailInput, setDeleteConfirmEmailInput] = useState("");
  const [deleteActionState, setDeleteActionState] = useState<{
    kind: "idle" | "deleting" | "error";
    message?: string;
  }>({ kind: "idle" });

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setGlobalMessage(null);

    try {
      const [settingsRes, usersRes] = await Promise.all([
        fetch("/api/admin/beta-settings", { method: "GET", credentials: "same-origin" }),
        fetch("/api/admin/beta-users", { method: "GET", credentials: "same-origin" }),
      ]);

      const settingsPayload = (await settingsRes.json().catch(() => ({}))) as BetaSettingsResponse;
      const usersPayload = (await usersRes.json().catch(() => ({}))) as BetaUsersResponse;

      if (!settingsRes.ok) {
        throw new Error(
          typeof settingsPayload.error === "string"
            ? settingsPayload.error
            : "Failed to load global beta settings."
        );
      }
      if (!usersRes.ok) {
        throw new Error(
          typeof usersPayload.error === "string"
            ? usersPayload.error
            : "Failed to load beta user data."
        );
      }

      const loadedBetaCode = normalizeString(settingsPayload.settings?.betaAccessCode);
      const loadedDefaultLimit = normalizeNonNegativeInt(
        settingsPayload.settings?.defaultTopupLimit,
        normalizeNonNegativeInt(usersPayload.defaultTopupLimit, 1)
      );

      setBetaAccessCode(loadedBetaCode);
      setDefaultTopupLimitInput(String(loadedDefaultLimit));
      setSettingsUpdatedAt(normalizeString(settingsPayload.settings?.updatedAt) || null);

      const loadedUsers = Array.isArray(usersPayload.users) ? usersPayload.users : [];
      setUsers(loadedUsers);
      setOverrideInputs(
        loadedUsers.reduce<Record<string, string>>((acc, user) => {
          acc[user.id] =
            typeof user.betaTopupLimitOverride === "number" ? String(user.betaTopupLimitOverride) : "";
          return acc;
        }, {})
      );
      setRowSaveState({});
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load admin controls.";
      setGlobalMessage({ kind: "error", text: message });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSaveGlobal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingGlobal(true);
    setGlobalMessage(null);

    const parsedDefaultLimit = Number.parseInt(defaultTopupLimitInput.trim(), 10);
    if (!Number.isFinite(parsedDefaultLimit) || parsedDefaultLimit < 0) {
      setGlobalMessage({ kind: "error", text: "Default top-up limit must be an integer >= 0." });
      setIsSavingGlobal(false);
      return;
    }
    if (betaAccessCode.trim().length < 4) {
      setGlobalMessage({ kind: "error", text: "Beta access code must be at least 4 characters." });
      setIsSavingGlobal(false);
      return;
    }

    try {
      const response = await fetch("/api/admin/beta-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          betaAccessCode: betaAccessCode.trim(),
          defaultTopupLimit: parsedDefaultLimit,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as BetaSettingsResponse;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to save global beta settings."
        );
      }

      setGlobalMessage({ kind: "success", text: "Global beta settings saved." });
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save global beta settings.";
      setGlobalMessage({ kind: "error", text: message });
    } finally {
      setIsSavingGlobal(false);
    }
  };

  const handleSaveUserOverride = async (userId: string) => {
    setRowSaveState((prev) => ({ ...prev, [userId]: { kind: "saving" } }));
    const rawValue = overrideInputs[userId] ?? "";
    const trimmed = rawValue.trim();
    if (trimmed.length > 0) {
      const parsed = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setRowSaveState((prev) => ({
          ...prev,
          [userId]: { kind: "error", message: "Use an integer >= 0, or leave empty." },
        }));
        return;
      }
    }

    try {
      const response = await fetch(`/api/admin/beta-users/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          betaTopupLimit: trimmed.length > 0 ? Number.parseInt(trimmed, 10) : null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "Failed to save user beta top-up limit override."
        );
      }

      setRowSaveState((prev) => ({
        ...prev,
        [userId]: { kind: "success", message: "Saved." },
      }));
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save override.";
      setRowSaveState((prev) => ({
        ...prev,
        [userId]: { kind: "error", message },
      }));
    }
  };

  const loadUserAudit = useCallback(
    async (userId: string) => {
      if (auditCacheByUserId[userId]) return;

      setAuditLoadState((prev) => ({ ...prev, [userId]: { kind: "loading" } }));
      try {
        const response = await fetch(`/api/admin/user-audit?userId=${encodeURIComponent(userId)}`, {
          method: "GET",
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => ({}))) as UserAuditResponse;
        if (!response.ok) {
          throw new Error(
            typeof payload.error === "string" ? payload.error : "Failed to load user audit details."
          );
        }
        if (!payload.audit) {
          throw new Error("User audit data is missing from the response.");
        }

        setAuditCacheByUserId((prev) => ({ ...prev, [userId]: payload.audit! }));
        setAuditLoadState((prev) => ({ ...prev, [userId]: { kind: "success" } }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to load user audit details.";
        setAuditLoadState((prev) => ({
          ...prev,
          [userId]: { kind: "error", message },
        }));
      }
    },
    [auditCacheByUserId]
  );

  const toggleUserAudit = useCallback(
    (userId: string) => {
      const isExpanded = Boolean(expandedUserAudits[userId]);
      const willExpand = !isExpanded;
      setExpandedUserAudits((prev) => ({ ...prev, [userId]: willExpand }));
      if (willExpand) {
        void loadUserAudit(userId);
      }
    },
    [expandedUserAudits, loadUserAudit]
  );

  const clearUserAuditCache = useCallback((userId: string) => {
    setAuditCacheByUserId((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setAuditLoadState((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setExpandedUserAudits((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
    setExpandedUserStoragePaths((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const openDeleteUserPanel = useCallback((userId: string) => {
    setDeleteTargetUserId(userId);
    setDeleteConfirmEmailInput("");
    setDeleteActionState({ kind: "idle" });
  }, []);

  const closeDeleteUserPanel = useCallback(() => {
    setDeleteTargetUserId(null);
    setDeleteConfirmEmailInput("");
    setDeleteActionState({ kind: "idle" });
  }, []);

  const handleDeleteUser = useCallback(
    async (userId: string, expectedEmail: string) => {
      if (!expectedEmail) {
        setDeleteActionState({
          kind: "error",
          message: "This user has no email on record, so deletion confirmation cannot proceed.",
        });
        return;
      }

      setDeleteActionState({ kind: "deleting" });
      setGlobalMessage(null);
      try {
        const response = await fetch("/api/admin/delete-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            userId,
            confirmEmail: deleteConfirmEmailInput,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as DeleteUserResponse;
        if (!response.ok || payload.success !== true) {
          throw new Error(
            typeof payload.error === "string" ? payload.error : "Failed to delete user and related data."
          );
        }

        clearUserAuditCache(userId);
        setUsers((prev) => (prev ?? []).filter((entry) => entry.id !== userId));
        closeDeleteUserPanel();
        await loadData();

        const deletedStorageFiles =
          typeof payload.deletedStorageFiles === "number" ? payload.deletedStorageFiles : 0;
        const skippedStorageFiles =
          typeof payload.skippedStorageFiles === "number" ? payload.skippedStorageFiles : 0;
        setGlobalMessage({
          kind: "success",
          text: `Deleted ${expectedEmail}. Removed ${deletedStorageFiles} storage file(s), skipped ${skippedStorageFiles}.`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to delete user.";
        setDeleteActionState({ kind: "error", message });
      }
    },
    [clearUserAuditCache, closeDeleteUserPanel, deleteConfirmEmailInput, loadData]
  );

  const sortedUsers = useMemo(() => {
    const clone = [...(users ?? [])];
    if (userSortBy === "last_sign_in") {
      return clone.sort((a, b) => {
        const aTimestamp = a.lastSignInAt ? Date.parse(a.lastSignInAt) : Number.NaN;
        const bTimestamp = b.lastSignInAt ? Date.parse(b.lastSignInAt) : Number.NaN;
        const aIsValid = Number.isFinite(aTimestamp);
        const bIsValid = Number.isFinite(bTimestamp);
        if (!aIsValid && !bIsValid) return 0;
        if (!aIsValid) return 1;
        if (!bIsValid) return -1;
        return bTimestamp - aTimestamp;
      });
    }
    if (userSortBy === "email") {
      return clone.sort((a, b) => {
        const aEmail = (a.email ?? "").toLocaleLowerCase();
        const bEmail = (b.email ?? "").toLocaleLowerCase();
        if (!aEmail && !bEmail) return 0;
        if (!aEmail) return 1;
        if (!bEmail) return -1;
        return aEmail.localeCompare(bEmail);
      });
    }
    return clone.sort((a, b) => {
      const aTimestamp = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
      const bTimestamp = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
      const aIsValid = Number.isFinite(aTimestamp);
      const bIsValid = Number.isFinite(bTimestamp);
      if (!aIsValid && !bIsValid) return 0;
      if (!aIsValid) return 1;
      if (!bIsValid) return -1;
      return bTimestamp - aTimestamp;
    });
  }, [users, userSortBy]);

  const filteredUsers = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sortedUsers;

    return sortedUsers.filter((user) => {
      const normalizedEmail = user.email?.trim().toLocaleLowerCase();
      if (!normalizedEmail) return false;
      return normalizedEmail.includes(normalizedQuery);
    });
  }, [searchQuery, sortedUsers]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Vibode Admin</h1>
          <p className="text-sm text-slate-400">
            Closed beta controls for access code and Stripe token top-up limits.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <h2 className="text-base font-medium text-slate-100">Global Beta Controls</h2>
          <p className="mt-1 text-xs text-slate-400">
            Configure the global beta access code and default top-up limit.
          </p>
          <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleSaveGlobal}>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span className="text-xs text-slate-400">Beta access code</span>
              <input
                type="text"
                value={betaAccessCode}
                onChange={(event) => setBetaAccessCode(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
                placeholder="VIBODE-BETA"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">Default top-up limit</span>
              <input
                type="number"
                min={0}
                step={1}
                value={defaultTopupLimitInput}
                onChange={(event) => setDefaultTopupLimitInput(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
            </label>

            <div className="md:col-span-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isSavingGlobal || isLoading}
                className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
              >
                {isSavingGlobal ? "Saving..." : "Save Global Settings"}
              </button>
              <span className="text-xs text-slate-500">
                Updated: {formatDate(settingsUpdatedAt)}
              </span>
            </div>
          </form>

          {globalMessage && (
            <p
              className={`mt-3 text-xs ${
                globalMessage.kind === "success" ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {globalMessage.text}
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-medium text-slate-100">Per-User Beta Top-up Overrides</h2>
            <button
              type="button"
              onClick={() => setIsUserOverridesExpanded((prev) => !prev)}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
            >
              {isUserOverridesExpanded ? "Hide users" : "Show users"}
            </button>
          </div>

          <p className="mt-1 text-xs text-slate-400">
            Empty override means inherit the global default limit.
          </p>

          {isUserOverridesExpanded && (
            <>
              <div className="mt-4">
                <div className="flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    onClick={() => void loadData()}
                    disabled={isLoading}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
                  >
                    {isLoading ? "Refreshing..." : "Refresh"}
                  </button>
                  <label className="flex items-center gap-2 text-xs text-slate-300">
                    <span>Sort by:</span>
                    <select
                      value={userSortBy}
                      onChange={(event) => setUserSortBy(event.target.value as UserSortOption)}
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    >
                      <option value="latest_joined">Latest joined</option>
                      <option value="last_sign_in">Last sign-in</option>
                      <option value="email">Email (A → Z)</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-300">Search</span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search by email..."
                      className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {filteredUsers.length > 0 ? (
                  filteredUsers.map((user) => {
                    const save = rowSaveState[user.id] ?? { kind: "idle" as const };
                    return (
                      <article
                        key={user.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-slate-100">{user.email ?? user.id}</p>
                            <p className="text-xs text-slate-400">
                              Top-ups used / limit: {user.topupsUsed} / {user.effectiveTopupLimit}
                            </p>
                            <p className="text-xs text-slate-500">
                              Joined: {formatDate(user.createdAt)} · Last sign-in: {formatDate(user.lastSignInAt)}
                            </p>
                            <p className="text-xs text-slate-500">
                              Current balance: {formatTokenBalance(user.currentTokenBalance)} tokens
                            </p>
                          </div>

                          <div className="flex items-end gap-2">
                            <button
                              type="button"
                              onClick={() => toggleUserAudit(user.id)}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200"
                            >
                              {expandedUserAudits[user.id] ? "Hide details" : "View details"}
                            </button>
                            <label className="flex flex-col gap-1">
                              <span className="text-[11px] text-slate-400">Override limit</span>
                              <input
                                type="number"
                                min={0}
                                step={1}
                                value={overrideInputs[user.id] ?? ""}
                                onChange={(event) =>
                                  setOverrideInputs((prev) => ({
                                    ...prev,
                                    [user.id]: event.target.value,
                                  }))
                                }
                                placeholder="inherit"
                                className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-emerald-400"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => void handleSaveUserOverride(user.id)}
                              disabled={save.kind === "saving"}
                              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-100 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
                            >
                              {save.kind === "saving" ? "Saving..." : "Save"}
                            </button>
                          </div>
                        </div>

                        {save.kind === "error" && (
                          <p className="mt-2 text-xs text-rose-300">{save.message ?? "Save failed."}</p>
                        )}
                        {save.kind === "success" && (
                          <p className="mt-2 text-xs text-emerald-300">{save.message ?? "Saved."}</p>
                        )}

                        {expandedUserAudits[user.id] && (
                          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
                            <p className="text-[11px] uppercase tracking-wide text-slate-400">Read-only audit</p>

                            {auditLoadState[user.id]?.kind === "loading" && (
                              <p className="mt-2 text-xs text-slate-300">Loading audit details...</p>
                            )}

                            {auditLoadState[user.id]?.kind === "error" && (
                              <p className="mt-2 text-xs text-rose-300">
                                {auditLoadState[user.id]?.message ?? "Failed to load audit details."}
                              </p>
                            )}

                            {(() => {
                              const audit = auditCacheByUserId[user.id];
                              if (!audit) return null;

                              const isStorageExpanded = Boolean(expandedUserStoragePaths[user.id]);
                              const totalRoomsOwned =
                                audit.counts.vibodeRoomsOwned + audit.counts.legacyRoomsOwned;
                              return (
                                <>
                                  <div className="mt-2 grid gap-1 text-xs text-slate-300 md:grid-cols-2">
                                    <p>Email: {audit.email ?? "—"}</p>
                                    <p>User ID: {audit.userId}</p>
                                    <p>Joined: {formatDate(audit.joinedAt)}</p>
                                    <p>Last sign-in: {formatDate(audit.lastSignInAt)}</p>
                                    <p>Current token balance: {formatTokenBalance(audit.currentTokenBalance)}</p>
                                    <p>Effective beta top-up limit: {audit.effectiveTopupLimit}</p>
                                    <p>
                                      Beta top-up override:{" "}
                                      {typeof audit.betaTopupLimitOverride === "number"
                                        ? audit.betaTopupLimitOverride
                                        : "inherit"}
                                    </p>
                                    <p>Top-up ledger rows: {audit.topupsUsed}</p>
                                  </div>

                                  <div className="mt-3 grid gap-1 text-xs text-slate-300 md:grid-cols-2">
                                    <p>Vibode rooms owned: {audit.counts.vibodeRoomsOwned}</p>
                                    <p>Legacy rooms owned: {audit.counts.legacyRoomsOwned}</p>
                                    <p>Total rooms owned: {totalRoomsOwned}</p>
                                    <p>My Furniture owned: {audit.counts.myFurnitureItemsOwned}</p>
                                    <p>Token ledger rows: {audit.counts.tokenLedgerRows}</p>
                                    <p>Beta user settings rows: {audit.counts.betaUserSettingsRows}</p>
                                  </div>

                                  {audit.optionalAuditCounts.length > 0 && (
                                    <div className="mt-3 space-y-1">
                                      <p className="text-[11px] uppercase tracking-wide text-slate-400">
                                        Additional related rows
                                      </p>
                                      {audit.optionalAuditCounts.map((entry) => (
                                        <p key={entry.table} className="text-xs text-slate-300">
                                          {entry.label}: {entry.count}
                                        </p>
                                      ))}
                                    </div>
                                  )}

                                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] uppercase tracking-wide text-slate-400">
                                        Storage paths
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedUserStoragePaths((prev) => ({
                                            ...prev,
                                            [user.id]: !isStorageExpanded,
                                          }))
                                        }
                                        className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-emerald-400/80 hover:text-emerald-200"
                                      >
                                        {isStorageExpanded ? "Hide" : "Show"}
                                      </button>
                                    </div>

                                    {isStorageExpanded && (
                                      <div className="mt-2 space-y-2">
                                        <div>
                                          <p className="text-[11px] text-slate-400">
                                            Exact paths ({audit.storageAudit.exactPaths.length})
                                          </p>
                                          {audit.storageAudit.exactPaths.length > 0 ? (
                                            <div className="mt-1 max-h-40 overflow-auto rounded border border-slate-800 bg-slate-900/60 p-2">
                                              {audit.storageAudit.exactPaths.map((entry, index) => (
                                                <p
                                                  key={`${entry.bucket}:${entry.path}:${index}`}
                                                  className="font-mono text-[11px] text-slate-300"
                                                >
                                                  [{entry.bucket}] {entry.path}
                                                </p>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="mt-1 text-xs text-slate-500">No exact paths found.</p>
                                          )}
                                        </div>

                                        <div>
                                          <p className="text-[11px] text-slate-400">
                                            Estimated paths ({audit.storageAudit.estimatedPaths.length})
                                          </p>
                                          {audit.storageAudit.estimatedPaths.length > 0 ? (
                                            <div className="mt-1 max-h-32 overflow-auto rounded border border-slate-800 bg-slate-900/60 p-2">
                                              {audit.storageAudit.estimatedPaths.map((entry, index) => (
                                                <p
                                                  key={`${entry.bucket}:${entry.path}:${index}`}
                                                  className="font-mono text-[11px] text-amber-200/90"
                                                >
                                                  [estimated: {entry.bucket}] {entry.path} —{" "}
                                                  {typeof entry.fileCount === "number"
                                                    ? `${entry.fileCount} files`
                                                    : "count unavailable"}
                                                </p>
                                              ))}
                                            </div>
                                          ) : (
                                            <p className="mt-1 text-xs text-slate-500">
                                              No estimated paths needed.
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  <div className="mt-3 rounded-lg border border-rose-700/60 bg-rose-950/20 p-3">
                                    <p className="text-[11px] uppercase tracking-wide text-rose-300">
                                      Danger zone
                                    </p>
                                    <p className="mt-1 text-xs text-rose-200/90">
                                      Permanently remove this user and all server-scoped Vibode data.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => openDeleteUserPanel(user.id)}
                                      className="mt-3 rounded-lg border border-rose-500/70 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:border-rose-400 hover:text-rose-100"
                                    >
                                      Delete user
                                    </button>

                                    {deleteTargetUserId === user.id && (
                                      <div className="mt-3 rounded-lg border border-rose-700 bg-slate-950/80 p-3">
                                        <p className="text-xs font-medium text-rose-200">
                                          This permanently deletes this user, their Vibode data, token
                                          history, and associated storage files. This cannot be undone.
                                        </p>
                                        <p className="mt-2 text-xs text-slate-300">
                                          Type <span className="font-mono">{audit.email ?? "no-email"}</span> to
                                          confirm.
                                        </p>
                                        <input
                                          type="text"
                                          value={deleteConfirmEmailInput}
                                          onChange={(event) => setDeleteConfirmEmailInput(event.target.value)}
                                          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-rose-400"
                                          placeholder="Enter exact user email"
                                        />
                                        {!audit.email && (
                                          <p className="mt-2 text-xs text-rose-300">
                                            Unable to confirm because this user has no email on record.
                                          </p>
                                        )}
                                        {deleteActionState.kind === "error" && (
                                          <p className="mt-2 text-xs text-rose-300">
                                            {deleteActionState.message ?? "Delete failed."}
                                          </p>
                                        )}
                                        <div className="mt-3 flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleDeleteUser(user.id, typeof audit.email === "string" ? audit.email : "")
                                            }
                                            disabled={
                                              deleteActionState.kind === "deleting" ||
                                              !audit.email ||
                                              deleteConfirmEmailInput !== audit.email
                                            }
                                            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-rose-50 transition hover:bg-rose-500 disabled:opacity-60"
                                          >
                                            {deleteActionState.kind === "deleting"
                                              ? "Deleting..."
                                              : "Permanently delete user"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={closeDeleteUserPanel}
                                            disabled={deleteActionState.kind === "deleting"}
                                            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 disabled:opacity-60"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">No users found.</p>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
