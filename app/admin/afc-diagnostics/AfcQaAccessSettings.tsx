"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type QaUser = {
  userId: string;
  email: string | null;
  addedAt: string | null;
};

type QaAccessPayload = {
  qaModeEnabled?: unknown;
  users?: unknown;
  error?: unknown;
};

function isQaUser(value: unknown): value is QaUser {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.userId === "string"
    && (record.email === null || typeof record.email === "string")
    && (record.addedAt === null || typeof record.addedAt === "string");
}

function readPayload(payload: QaAccessPayload): { qaModeEnabled: boolean; users: QaUser[] } | null {
  if (typeof payload.qaModeEnabled !== "boolean" || !Array.isArray(payload.users)) return null;
  if (!payload.users.every(isQaUser)) return null;
  return { qaModeEnabled: payload.qaModeEnabled, users: payload.users };
}

export default function AfcQaAccessSettings() {
  const [qaModeEnabled, setQaModeEnabled] = useState(false);
  const [users, setUsers] = useState<QaUser[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "saving">("loading");

  const applyPayload = useCallback((payload: QaAccessPayload) => {
    const parsed = readPayload(payload);
    if (!parsed) throw new Error("AFC QA access settings were unreadable.");
    setQaModeEnabled(parsed.qaModeEnabled);
    setUsers(parsed.users);
  }, []);

  const loadAccess = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/admin/afc-qa-access", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as QaAccessPayload;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string" ? payload.error : "Failed to load AFC QA access.",
        );
      }
      applyPayload(payload);
      setLoaded(true);
    } catch (err: unknown) {
      setLoaded(false);
      setError(err instanceof Error ? err.message : "Failed to load AFC QA access.");
    } finally {
      setStatus("ready");
    }
  }, [applyPayload]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const mutate = useCallback(async (
    method: "PATCH" | "POST" | "DELETE",
    body: Record<string, unknown>,
    fallback: string,
  ): Promise<boolean> => {
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch("/api/admin/afc-qa-access", {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as QaAccessPayload;
      if (!response.ok) {
        throw new Error(typeof payload.error === "string" ? payload.error : fallback);
      }
      applyPayload(payload);
      return true;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : fallback);
      return false;
    } finally {
      setStatus("ready");
    }
  }, [applyPayload]);

  const addUser = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const nextEmail = email.trim();
    if (!nextEmail) {
      setError("Enter a valid email address.");
      return;
    }
    if (users.some((user) => user.email?.trim().toLowerCase() === nextEmail.toLowerCase())) {
      setError("This user already has AFC QA access.");
      return;
    }
    const added = await mutate("POST", { email: nextEmail }, "Failed to add that QA user.");
    if (added) setEmail("");
  }, [email, mutate, users]);

  const removeUser = useCallback(async (user: QaUser) => {
    const label = user.email ?? user.userId;
    if (!window.confirm(`Remove AFC QA access for ${label}?`)) return;
    await mutate("DELETE", { userId: user.userId }, "Failed to remove that QA user.");
  }, [mutate]);

  const busy = status !== "ready" || !loaded;

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4" data-afc-qa-access="true">
      <h2 className="text-base font-medium text-slate-100">AFC QA Access</h2>
      <p className="mt-1 text-xs text-slate-400">
        QA requests are allowed only when QA Mode is enabled and the signed-in user is on this list.
        Changes apply to the next request.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">QA Mode</span>
        <button
          type="button"
          aria-pressed={qaModeEnabled}
          aria-label="AFC QA Mode"
          disabled={busy}
          onClick={() => void mutate(
            "PATCH",
            { qaModeEnabled: !qaModeEnabled },
            "Failed to update QA Mode.",
          )}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-60"
        >
          {qaModeEnabled ? "Enabled" : "Disabled"}
        </button>
      </div>
      <h3 className="mt-5 text-sm font-medium text-slate-200">Authorized QA Users</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="py-2 pr-3 font-medium">User</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 font-medium">Access</th>
            </tr>
          </thead>
          <tbody>
            {status === "loading" || !loaded ? (
              <tr className="border-t border-slate-800">
                <td className="py-3 text-slate-500" colSpan={3}>
                  {error ? "AFC QA access could not be loaded." : "Loading AFC QA access..."}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr className="border-t border-slate-800">
                <td className="py-3 text-slate-500" colSpan={3}>No authorized QA users.</td>
              </tr>
            ) : users.map((user) => (
              <tr key={user.userId} className="border-t border-slate-800">
                <td className="py-2 pr-3 font-mono text-xs text-slate-300">{user.userId}</td>
                <td className="py-2 pr-3 text-slate-200">{user.email ?? "Email unavailable"}</td>
                <td className="py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void removeUser(user)}
                    className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-200 outline-none focus:border-emerald-400 disabled:opacity-60"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(event) => void addUser(event)}>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className="text-xs text-slate-400">Add QA User</span>
          <input
            type="email"
            value={email}
            aria-label="QA user email"
            placeholder="Existing Vibode user email"
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-60"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-400 disabled:opacity-60"
        >
          Add QA User
        </button>
      </form>
      {error ? (
        <p className="mt-3 text-xs text-rose-300" role="alert">{error}</p>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          {status === "saving"
            ? "Saving AFC QA access..."
            : status === "loading"
              ? "Loading AFC QA access..."
              : "QA Mode and the allowlist save immediately."}
        </p>
      )}
    </section>
  );
}
