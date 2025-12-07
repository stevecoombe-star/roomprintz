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

export function useAgentProfile() {
  const { user, loading: authLoading } = useSupabaseUser();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      if (authLoading) return;

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            "id, full_name, brokerage_name, brokerage_address, phone, agent_photo_url"
          )
          .eq("id", user.id)
          .maybeSingle();

        if (error) {
          console.error("[useAgentProfile] error:", error);
          setError(error.message);
          setProfile(null);
        } else {
          setProfile({
            id: user.id,
            full_name: data?.full_name ?? null,
            brokerage_name: data?.brokerage_name ?? null,
            brokerage_address: data?.brokerage_address ?? null,
            phone: data?.phone ?? null,
            agent_photo_url: data?.agent_photo_url ?? null,
            email: user.email ?? null,
          });
        }
      } catch (err: any) {
        console.error("[useAgentProfile] unexpected error:", err);
        setError(err?.message ?? "Unexpected error");
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [authLoading, user?.id, user?.email]);

  return { profile, loading, error };
}
