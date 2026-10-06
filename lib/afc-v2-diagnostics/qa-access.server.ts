import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";

import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
} from "./admin-auth.server";
import {
  afcQaAccessConfig,
  disabledAfcQaAccessConfig,
  normalizeAfcQaEmail,
  normalizeAfcQaUserId,
  type AfcQaAccessConfig,
} from "./qa-access";

export const AFC_QA_SETTINGS_ID = "global";
export const AFC_QA_SETTINGS_TABLE = "afc_qa_settings";
export const AFC_QA_USERS_TABLE = "afc_qa_users";
export const AFC_QA_ACCESS_MIGRATION = "20261005170000_afc_qa_access.sql";

const USER_PAGE_SIZE = 200;
const USER_PAGE_LIMIT = 20;

export type AfcQaAccessUser = Readonly<{
  userId: string;
  email: string | null;
  addedAt: string | null;
}>;

export type AfcQaAccessSnapshot = Readonly<{
  qaModeEnabled: boolean;
  users: readonly AfcQaAccessUser[];
}>;

export type AfcQaAccessFailure = Readonly<{
  ok: false;
  status: number;
  error: string;
}>;

export type AfcQaAccessSuccess = Readonly<{
  ok: true;
  snapshot: AfcQaAccessSnapshot;
}>;

export type AfcQaAccessMutation = AfcQaAccessSuccess | AfcQaAccessFailure;

export type AfcQaDirectory = {
  findByEmail(email: string): Promise<
    | { ok: true; user: { userId: string; email: string | null } | null }
    | { ok: false; reason: "lookup_failed" | "ambiguous" | "incomplete" }
  >;
  findById(userId: string): Promise<{ email: string | null } | null>;
};

type AuthUser = { id: string; email?: string | null };

export type AfcQaAuthAdmin = {
  listUsers(params: { page?: number; perPage?: number }): Promise<{
    data: { users: AuthUser[] } | null;
    error: { message?: string } | null;
  }>;
  getUserById(userId: string): Promise<{
    data: { user: AuthUser | null } | null;
    error: { message?: string } | null;
  }>;
};

type SettingsRow = { qa_mode_enabled?: unknown; updated_at?: unknown };
type UserRow = {
  user_id?: unknown;
  email_snapshot?: unknown;
  added_at?: unknown;
};

export type AfcQaAccessStore = {
  client: SupabaseClient | null;
  directory?: AfcQaDirectory;
  addedBy?: string | null;
};

const MIGRATION_ERROR =
  `Failed to read AFC QA access. Apply migration ${AFC_QA_ACCESS_MIGRATION} if it has not been applied.`;
const SAVE_ERROR =
  `Failed to save AFC QA access. Apply migration ${AFC_QA_ACCESS_MIGRATION} if it has not been applied.`;
const CONFIG_ERROR = "Server configuration missing for admin settings.";

function failure(status: number, error: string): AfcQaAccessFailure {
  return Object.freeze({ ok: false, status, error });
}

function success(snapshot: AfcQaAccessSnapshot): AfcQaAccessSuccess {
  return Object.freeze({ ok: true, snapshot });
}

function serviceClient(): SupabaseClient | null {
  return getServiceRoleSupabaseClient();
}

export function createAfcQaDirectory(admin: AfcQaAuthAdmin): AfcQaDirectory {
  return {
    async findByEmail(email) {
      const target = normalizeAfcQaEmail(email);
      if (!target) return { ok: true, user: null };
      const matches: Array<{ userId: string; email: string | null }> = [];
      for (let page = 1; page <= USER_PAGE_LIMIT; page += 1) {
        let result: Awaited<ReturnType<AfcQaAuthAdmin["listUsers"]>>;
        try {
          result = await admin.listUsers({ page, perPage: USER_PAGE_SIZE });
        } catch {
          return { ok: false, reason: "lookup_failed" };
        }
        if (result.error) return { ok: false, reason: "lookup_failed" };
        const users = result.data?.users ?? [];
        for (const user of users) {
          if (normalizeAfcQaEmail(user.email) !== target) continue;
          const userId = normalizeAfcQaUserId(user.id);
          if (!userId) continue;
          matches.push({
            userId,
            email: typeof user.email === "string" ? user.email : null,
          });
        }
        if (users.length < USER_PAGE_SIZE) {
          if (matches.length > 1) return { ok: false, reason: "ambiguous" };
          return { ok: true, user: matches[0] ?? null };
        }
      }
      return { ok: false, reason: "incomplete" };
    },
    async findById(userId) {
      try {
        const result = await admin.getUserById(userId);
        if (result.error || !result.data?.user) return null;
        const email = result.data.user.email;
        return {
          email: typeof email === "string" && email.trim().length > 0 ? email : null,
        };
      } catch {
        return null;
      }
    },
  };
}

function directoryFor(client: SupabaseClient | null): AfcQaDirectory | undefined {
  if (!client) return undefined;
  return createAfcQaDirectory(client.auth.admin);
}

/**
 * Authorization read. Every call queries the database. Missing credentials,
 * a missing migration, and transport errors fail closed to QA disabled.
 */
export async function readAfcQaAccessConfig(
  client: SupabaseClient | null = serviceClient(),
): Promise<AfcQaAccessConfig> {
  if (!client) return disabledAfcQaAccessConfig();
  try {
    const settings = await client
      .from(AFC_QA_SETTINGS_TABLE)
      .select("qa_mode_enabled")
      .eq("id", AFC_QA_SETTINGS_ID)
      .maybeSingle<SettingsRow>();
    if (settings.error || settings.data?.qa_mode_enabled !== true) {
      return disabledAfcQaAccessConfig();
    }
    const users = await client
      .from(AFC_QA_USERS_TABLE)
      .select("user_id");
    if (users.error) return disabledAfcQaAccessConfig();
    const ids: string[] = [];
    for (const row of (users.data ?? []) as UserRow[]) {
      const id = normalizeAfcQaUserId(row.user_id);
      if (id) ids.push(id);
    }
    return afcQaAccessConfig(true, ...ids);
  } catch {
    return disabledAfcQaAccessConfig();
  }
}

async function loadSnapshot(
  client: SupabaseClient,
  directory: AfcQaDirectory | undefined,
): Promise<AfcQaAccessMutation> {
  const settings = await client
    .from(AFC_QA_SETTINGS_TABLE)
    .select("qa_mode_enabled,updated_at")
    .eq("id", AFC_QA_SETTINGS_ID)
    .maybeSingle<SettingsRow>();
  if (settings.error) return failure(500, MIGRATION_ERROR);
  const users = await client
    .from(AFC_QA_USERS_TABLE)
    .select("user_id,email_snapshot,added_at")
    .order("added_at", { ascending: true });
  if (users.error) return failure(500, MIGRATION_ERROR);
  const listed: AfcQaAccessUser[] = [];
  for (const row of (users.data ?? []) as UserRow[]) {
    const userId = normalizeAfcQaUserId(row.user_id);
    if (!userId) continue;
    const snapshotEmail = displayEmail(row.email_snapshot);
    let email = snapshotEmail;
    if (directory) {
      const live = await directory.findById(userId);
      const liveEmail = displayEmail(live?.email);
      if (liveEmail) email = liveEmail;
    }
    listed.push(Object.freeze({
      userId,
      email,
      addedAt: typeof row.added_at === "string" ? row.added_at : null,
    }));
  }
  return success(Object.freeze({
    qaModeEnabled: settings.data?.qa_mode_enabled === true,
    users: Object.freeze(listed),
  }));
}

function displayEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return normalizeAfcQaEmail(trimmed) ? trimmed : null;
}

function requireClient(store: AfcQaAccessStore): SupabaseClient | null {
  return store.client;
}

export async function readAfcQaAccessAdmin(
  store: AfcQaAccessStore,
): Promise<AfcQaAccessMutation> {
  const client = requireClient(store);
  if (!client) return failure(500, CONFIG_ERROR);
  try {
    return await loadSnapshot(client, store.directory ?? directoryFor(client));
  } catch {
    return failure(500, MIGRATION_ERROR);
  }
}

export async function setAfcQaModeEnabled(
  qaModeEnabled: boolean,
  store: AfcQaAccessStore,
): Promise<AfcQaAccessMutation> {
  if (typeof qaModeEnabled !== "boolean") {
    return failure(400, "QA Mode must be enabled or disabled.");
  }
  const client = requireClient(store);
  if (!client) return failure(500, CONFIG_ERROR);
  try {
    const saved = await client.from(AFC_QA_SETTINGS_TABLE).upsert({
      id: AFC_QA_SETTINGS_ID,
      qa_mode_enabled: qaModeEnabled,
      updated_at: new Date().toISOString(),
    });
    if (saved.error) return failure(500, SAVE_ERROR);
    return await loadSnapshot(client, store.directory ?? directoryFor(client));
  } catch {
    return failure(500, SAVE_ERROR);
  }
}

export async function addAfcQaUserByEmail(
  email: unknown,
  store: AfcQaAccessStore,
): Promise<AfcQaAccessMutation> {
  const normalized = normalizeAfcQaEmail(email);
  if (!normalized) return failure(400, "Enter a valid email address.");
  const client = requireClient(store);
  if (!client) return failure(500, CONFIG_ERROR);
  const directory = store.directory ?? directoryFor(client);
  if (!directory) return failure(500, CONFIG_ERROR);
  let resolved: Awaited<ReturnType<AfcQaDirectory["findByEmail"]>>;
  try {
    resolved = await directory.findByEmail(normalized);
  } catch {
    return failure(500, "Failed to resolve that account.");
  }
  if (!resolved.ok) {
    if (resolved.reason === "ambiguous") {
      return failure(409, "More than one Vibode account matches that email.");
    }
    return failure(500, "Failed to resolve that account.");
  }
  if (!resolved.user) return failure(404, "No Vibode account matches that email.");
  const userId = normalizeAfcQaUserId(resolved.user.userId);
  if (!userId) return failure(404, "No Vibode account matches that email.");
  try {
    const existing = await client
      .from(AFC_QA_USERS_TABLE)
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle<UserRow>();
    if (existing.error) return failure(500, SAVE_ERROR);
    if (existing.data) {
      return failure(409, "This user already has AFC QA access.");
    }
    const inserted = await client.from(AFC_QA_USERS_TABLE).insert({
      user_id: userId,
      email_snapshot: resolved.user.email ?? normalized,
      added_at: new Date().toISOString(),
      added_by: normalizeAfcQaUserId(store.addedBy),
    });
    if (inserted.error) {
      if (inserted.error.code === "23505") {
        return failure(409, "This user already has AFC QA access.");
      }
      return failure(500, SAVE_ERROR);
    }
    return await loadSnapshot(client, directory);
  } catch {
    return failure(500, SAVE_ERROR);
  }
}

export async function removeAfcQaUser(
  userId: unknown,
  store: AfcQaAccessStore,
): Promise<AfcQaAccessMutation> {
  const id = normalizeAfcQaUserId(userId);
  if (!id) return failure(400, "Unknown user.");
  const client = requireClient(store);
  if (!client) return failure(500, CONFIG_ERROR);
  try {
    const removed = await client
      .from(AFC_QA_USERS_TABLE)
      .delete()
      .eq("user_id", id)
      .select("user_id");
    if (removed.error) return failure(500, SAVE_ERROR);
    const rows = (removed.data ?? []) as UserRow[];
    if (rows.length === 0) {
      return failure(404, "That user is not on the AFC QA allowlist.");
    }
    return await loadSnapshot(client, store.directory ?? directoryFor(client));
  } catch {
    return failure(500, SAVE_ERROR);
  }
}

export type AfcQaAccessHandlerArgs = {
  request?: Request;
  authorize?: () => Promise<AfcDiagnosticsAdminAuth>;
  client?: SupabaseClient | null;
  directory?: AfcQaDirectory;
};

function storeFrom(args: AfcQaAccessHandlerArgs, addedBy: string | null): AfcQaAccessStore {
  return {
    client: args.client === undefined ? serviceClient() : args.client,
    directory: args.directory,
    addedBy,
  };
}

async function requireAdmin(args: AfcQaAccessHandlerArgs) {
  const authorize = args.authorize ?? (() => authorizeAfcDiagnosticsAdmin());
  return authorize();
}

function snapshotResponse(result: AfcQaAccessSuccess) {
  return afcDiagnosticsAdminJson({
    qaModeEnabled: result.snapshot.qaModeEnabled,
    users: result.snapshot.users.map((user) => ({
      userId: user.userId,
      email: user.email,
      addedAt: user.addedAt,
    })),
  }, 200);
}

function mutationResponse(result: AfcQaAccessMutation) {
  if (!result.ok) return afcDiagnosticsAdminJson({ error: result.error }, result.status);
  return snapshotResponse(result);
}

export async function handleAfcQaAccessGet(args: AfcQaAccessHandlerArgs = {}) {
  const auth = await requireAdmin(args);
  if (!auth.ok) return auth.response;
  return mutationResponse(await readAfcQaAccessAdmin(storeFrom(args, auth.admin.userId)));
}

export async function handleAfcQaAccessSetMode(args: AfcQaAccessHandlerArgs = {}) {
  const auth = await requireAdmin(args);
  if (!auth.ok) return auth.response;
  const payload = (await args.request?.json().catch(() => null)) as { qaModeEnabled?: unknown } | null;
  if (!payload || typeof payload.qaModeEnabled !== "boolean") {
    return afcDiagnosticsAdminJson({ error: "QA Mode must be enabled or disabled." }, 400);
  }
  return mutationResponse(await setAfcQaModeEnabled(
    payload.qaModeEnabled,
    storeFrom(args, auth.admin.userId),
  ));
}

export async function handleAfcQaAccessAdd(args: AfcQaAccessHandlerArgs = {}) {
  const auth = await requireAdmin(args);
  if (!auth.ok) return auth.response;
  const payload = (await args.request?.json().catch(() => null)) as { email?: unknown } | null;
  return mutationResponse(await addAfcQaUserByEmail(
    payload?.email,
    storeFrom(args, auth.admin.userId),
  ));
}

export async function handleAfcQaAccessRemove(args: AfcQaAccessHandlerArgs = {}) {
  const auth = await requireAdmin(args);
  if (!auth.ok) return auth.response;
  const payload = (await args.request?.json().catch(() => null)) as { userId?: unknown } | null;
  return mutationResponse(await removeAfcQaUser(
    payload?.userId,
    storeFrom(args, auth.admin.userId),
  ));
}
