// lib/useAgentProfile.ts
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "./useSupabaseUser";

type AgentProfile = {
  id: string;
  full_name: string | null;
  brokerage_name: string | null;
  brokerage_address: string | null;
  phone: string | null;
  agent_photo_url: string | null;
  email: string | null;
};

function errorMessageFromUnknown(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim().length > 0) return err;
  return fallback;
}

type ProfileRow = {
  full_name: string | null;
  brokerage_name: string | null;
  brokerage_address: string | null;
  phone: string | null;
  agent_photo_url: string | null;
};

export function useAgentProfile() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      if (authLoading) return;

      if (!user) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
          setError(null);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
        setError(null);
      }

      try {
        const { data, error: dbErr } = await supabase
          .from("profiles")
          .select(
            "full_name, brokerage_name, brokerage_address, phone, agent_photo_url"
          )
          .eq("id", user.id)
          .maybeSingle();

        if (dbErr) {
          console.error("[useAgentProfile] error:", dbErr);
          if (!cancelled) {
            setError(dbErr.message);
            setProfile(null);
          }
          return;
        }

        const row = (data ?? null) as ProfileRow | null;

        if (!cancelled) {
          setProfile({
            id: user.id,
            full_name: row?.full_name ?? null,
            brokerage_name: row?.brokerage_name ?? null,
            brokerage_address: row?.brokerage_address ?? null,
            phone: row?.phone ?? null,
            agent_photo_url: row?.agent_photo_url ?? null,
            email: user.email ?? null,
          });
        }
      } catch (err: unknown) {
        console.error("[useAgentProfile] unexpected error:", err);
        if (!cancelled) {
          setError(errorMessageFromUnknown(err, "Unexpected error"));
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, user?.id, user?.email]);

  return { profile, loading, error };
}
