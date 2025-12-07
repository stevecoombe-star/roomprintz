// components/ProfileSettings.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAgentProfile } from "@/lib/useAgentProfile";
import { useSupabaseUser } from "@/lib/useSupabaseUser";

export function ProfileSettings() {
  const { user, loading: authLoading } = useSupabaseUser();
  const { profile, loading: profileLoading } = useAgentProfile();

  const [fullName, setFullName] = useState("");
  const [brokerageName, setBrokerageName] = useState("");
  const [brokerageAddress, setBrokerageAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");

  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize form fields when profile loads
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? "");
    setBrokerageName(profile.brokerage_name ?? "");
    setBrokerageAddress(profile.brokerage_address ?? "");
    setPhone(profile.phone ?? "");
    setPhotoUrl(profile.agent_photo_url ?? "");
  }, [profile?.id]);

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: fullName || null,
        brokerage_name: brokerageName || null,
        brokerage_address: brokerageAddress || null,
        phone: phone || null,
        agent_photo_url: photoUrl || null,
      });

      if (error) {
        console.error("[ProfileSettings] upsert error:", error);
        setErrorMessage(error.message);
        return;
      }

      setStatusMessage("Profile updated.");
    } catch (err: any) {
      console.error("[ProfileSettings] unexpected error:", err);
      setErrorMessage(err?.message ?? "Unexpected error while saving.");
    } finally {
      setSaving(false);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  if (authLoading) return null;
  if (!user) return null; // /app should normally require login anyway

  const isLoading = profileLoading && !profile;

  return (
    <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Profile settings
          </h2>
          <p className="text-[11px] text-slate-400">
            Update the details shown at the top of your RoomPrintz dashboard.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400 py-4">Loading profile…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2 text-xs">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">Full name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
              placeholder="Jane Williams"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">
              Brokerage name
            </label>
            <input
              type="text"
              value={brokerageName}
              onChange={(e) => setBrokerageName(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
              placeholder="RE/MAX Elite Realty"
            />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] text-slate-400">
              Brokerage address
            </label>
            <input
              type="text"
              value={brokerageAddress}
              onChange={(e) => setBrokerageAddress(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
              placeholder="123 Main Street, Vancouver, BC"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">Phone</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
              placeholder="(604) 555-1234"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-slate-400">
              Agent photo URL
            </label>
            <input
              type="text"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
              placeholder="https://…/your-headshot.jpg"
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || isLoading}
          className="text-[11px] rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-3 py-1.5 font-medium transition"
        >
          {saving ? "Saving…" : "Save profile"}
        </button>

        {statusMessage && (
          <span className="text-[11px] text-emerald-300">
            {statusMessage}
          </span>
        )}
        {errorMessage && (
          <span className="text-[11px] text-rose-300">
            {errorMessage}
          </span>
        )}
      </div>
    </section>
  );
}
