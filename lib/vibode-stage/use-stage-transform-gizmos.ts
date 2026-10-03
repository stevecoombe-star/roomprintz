"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";

const STAGE_TRANSFORM_GIZMOS_URL = "/api/vibode/stage/transform-gizmos";

/**
 * Fail closed. Gizmos appear only after the server says this user is allowed.
 */
export function useStageTransformGizmos(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getSupabaseBrowserAccessToken();
        if (!token || cancelled) return;
        const response = await fetch(STAGE_TRANSFORM_GIZMOS_URL, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
          },
          cache: "no-store",
        });
        if (!response.ok || cancelled) return;
        const payload: unknown = await response.json();
        if (
          !cancelled
          && payload != null
          && typeof payload === "object"
          && "enabled" in payload
          && payload.enabled === true
        ) {
          setEnabled(true);
        }
      } catch {
        // Stay on the consumer default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
