"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { PARTNER_VARIANT_ORDER_SAVED_EVENT } from "@/lib/vibode-stage/partner-variant-order";

export function PartnerProductEditorRefresh() {
  const router = useRouter();
  useEffect(() => {
    function onSaved() {
      router.refresh();
    }
    window.addEventListener(PARTNER_VARIANT_ORDER_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(PARTNER_VARIANT_ORDER_SAVED_EVENT, onSaved);
  }, [router]);
  return null;
}
