"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type SignOutButtonProps = {
  className?: string;
};

export function SignOutButton({ className }: SignOutButtonProps) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);

    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[SignOutButton] signOut error:", err);
    } finally {
      router.replace("/login");
      router.refresh();
      setIsSigningOut(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleSignOut();
      }}
      disabled={isSigningOut}
      className={className}
    >
      {isSigningOut ? "Signing out..." : "Sign out"}
    </button>
  );
}
