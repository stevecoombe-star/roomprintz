import "server-only";

import { getCookieSupabaseClient } from "@/lib/adminServer";

import { harmonizeActorDecision, harmonizeMode } from "./access";

export async function readHarmonizeActor(): Promise<
  | Readonly<{ ok: true; userId: string; email: string | null }>
  | Readonly<{ ok: false; code: "disabled" | "unauthenticated" | "forbidden" }>
> {
  const mode = harmonizeMode();
  if (mode !== "admin") return { ok: false, code: "disabled" };
  const supabase = await getCookieSupabaseClient();
  if (!supabase) return { ok: false, code: "unauthenticated" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return { ok: false, code: "unauthenticated" };
  const decision = harmonizeActorDecision({
    mode,
    userId: data.user.id,
    email: data.user.email,
  });
  if (decision !== "ok") return { ok: false, code: decision };
  return { ok: true, userId: data.user.id, email: data.user.email ?? null };
}
