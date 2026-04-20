// lib/useSupabaseUser.ts
"use client";

import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { getSupabaseBrowserSession } from "./supabaseBrowser";
import type { User } from "@supabase/supabase-js";

type UseSupabaseUserResult = {
  user: User | null;
  loading: boolean;
};

export function useSupabaseUser(): UseSupabaseUserResult {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        const { data, error } = await getSupabaseBrowserSession();
        if (!isMounted) return;

        if (error) {
          console.error("[useSupabaseUser] getSession error:", error);
        }

        const session = data?.session ?? null;
        setUser(session?.user ?? null);
      } catch (err) {
        if (!isMounted) return;
        console.error("[useSupabaseUser] unexpected getSession error:", err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
