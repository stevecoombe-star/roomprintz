"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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
  }>;
  defaultTopupLimit?: unknown;
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
                <button
                  type="button"
                  onClick={() => void loadData()}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 transition hover:border-emerald-400/80 hover:text-emerald-200 disabled:opacity-60"
                >
                  {isLoading ? "Refreshing..." : "Refresh"}
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {users && users.length > 0 ? (
                  users.map((user) => {
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
                          </div>

                          <div className="flex items-end gap-2">
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
