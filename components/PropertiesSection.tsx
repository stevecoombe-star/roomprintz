// components/PropertiesSection.tsx
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import Link from "next/link";

type Property = {
  id: string;
  title: string | null;
  address_line_1: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  mls_number: string | null;
  updated_at: string;
  main_image_url: string | null;
};

type PropertiesSectionProps = {
  refreshToken?: number; // NEW
};

export function PropertiesSection({ refreshToken = 0 }: PropertiesSectionProps) {
  const { user, loading: authLoading } = useSupabaseUser();
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // form fields
  const [title, setTitle] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateProvince, setStateProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("");
  const [mlsNumber, setMlsNumber] = useState("");

  const loadProperties = async () => {
    if (!user) {
      setProperties([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const { data, error } = await supabase
        .from("properties")
        .select(
          "id, title, address_line_1, city, state_province, postal_code, mls_number, updated_at, main_image_url"
        )
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) {
        console.error("[PropertiesSection] load error:", error);
        setErrorMessage(error.message);
        setProperties([]);
      } else {
        setProperties(data ?? []);
      }
    } catch (err: any) {
      console.error("[PropertiesSection] unexpected error:", err);
      setErrorMessage(err?.message ?? "Unexpected error loading properties.");
      setProperties([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    loadProperties();
  }, [authLoading, user?.id, refreshToken]); // 👈 refreshToken added here

  const resetForm = () => {
    setTitle("");
    setAddress1("");
    setAddress2("");
    setCity("");
    setStateProvince("");
    setPostalCode("");
    setCountry("");
    setMlsNumber("");
    setErrorMessage(null);
  };

  const handleOpenModal = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const handleCreateProperty = async () => {
    if (!user) return;
    if (!address1 && !title) {
      setErrorMessage("Please enter at least a property title or address.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const { error } = await supabase.from("properties").insert({
        user_id: user.id,
        title: title || null,
        address_line_1: address1 || null,
        address_line_2: address2 || null,
        city: city || null,
        state_province: stateProvince || null,
        postal_code: postalCode || null,
        country: country || null,
        mls_number: mlsNumber || null,
      });

      if (error) {
        console.error("[PropertiesSection] insert error:", error);
        setErrorMessage(error.message);
        return;
      }

      setIsModalOpen(false);
      await loadProperties();
    } catch (err: any) {
      console.error("[PropertiesSection] unexpected insert error:", err);
      setErrorMessage(err?.message ?? "Unexpected error creating property.");
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !user) {
    // Only show this section for logged-in users, on /app.
    return null;
  }

  return (
    <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Your properties
          </h2>
          <p className="text-[11px] text-slate-400">
            Create a property for each listing and keep all staged rooms
            organized in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenModal}
          className="text-[11px] rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-1.5 font-medium transition"
        >
          + New property
        </button>
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400 py-4">
          Loading your properties…
        </div>
      ) : properties.length === 0 ? (
        <div className="text-xs text-slate-500 py-4">
          You don&apos;t have any properties yet. Create your first one to
          start organizing staged rooms by listing.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mt-1">
          {properties.map((property) => {
            const updatedDate = new Date(property.updated_at);
            const updatedLabel = updatedDate.toLocaleString();

            const displayTitle =
              property.title ||
              property.address_line_1 ||
              "Untitled property";

            const displayAddress = [
              property.address_line_1,
              property.city,
              property.state_province,
            ]
              .filter(Boolean)
              .join(", ");

            return (
              <article
                key={property.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/80 px-3 py-3 flex gap-2 shadow-[0_0_0_1px_rgba(15,23,42,0.7)] hover:shadow-[0_14px_30px_rgba(15,23,42,0.9)] hover:border-emerald-500/40 transition"
              >
                {/* Thumbnail */}
                {property.main_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={property.main_image_url}
                    alt={`${displayTitle} main`}
                    className="w-14 h-14 rounded-xl object-cover border border-slate-800 bg-black flex-shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-[10px] text-slate-500 bg-slate-950/60 flex-shrink-0">
                    No photo
                  </div>
                )}

                <div className="flex-1 flex flex-col gap-0.5">
                  <div className="text-sm font-medium text-slate-50 truncate">
                    {displayTitle}
                  </div>
                  {displayAddress && (
                    <div className="text-[11px] text-slate-400 truncate">
                      {displayAddress}
                    </div>
                  )}
                  {property.mls_number && (
                    <div className="text-[11px] text-slate-500">
                      MLS {property.mls_number}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 mt-1">
                    Updated {updatedLabel}
                  </div>
                  <div className="mt-1 flex justify-end">
                    <Link
                      href={`/app/properties/${property.id}`}
                      className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                    >
                      View property
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* New Property Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-40 flex justify-center overflow-y-auto bg-black/70">
          <div
            className="fixed inset-0"
            onClick={() => !saving && setIsModalOpen(false)}
          />
          <div className="relative z-50 w-full max-w-lg mx-4 my-10 bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold">New property</h3>
              <button
                type="button"
                onClick={() => !saving && setIsModalOpen(false)}
                className="text-[11px] rounded-full border border-slate-700 px-2 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 text-xs space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">
                  Property title (optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="Maple Street Bungalow"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">
                  Address line 1
                </label>
                <input
                  type="text"
                  value={address1}
                  onChange={(e) => setAddress1(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="123 Maple Street"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-slate-400">
                  Address line 2 (optional)
                </label>
                <input
                  type="text"
                  value={address2}
                  onChange={(e) => setAddress2(e.target.value)}
                  className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                  placeholder="Suite 305"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="Vancouver"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">
                    State / Province
                  </label>
                  <input
                    type="text"
                    value={stateProvince}
                    onChange={(e) => setStateProvince(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="BC"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">
                    Postal code
                  </label>
                  <input
                    type="text"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="V6B 2X3"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">
                    Country (optional)
                  </label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="Canada"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] text-slate-400">
                    MLS number (optional)
                  </label>
                  <input
                    type="text"
                    value={mlsNumber}
                    onChange={(e) => setMlsNumber(e.target.value)}
                    className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="R2839121"
                  />
                </div>
              </div>

              {errorMessage && (
                <div className="text-[11px] text-rose-300 mt-1">
                  {errorMessage}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => !saving && setIsModalOpen(false)}
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1.5 hover:border-slate-500 transition"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateProperty}
                disabled={saving}
                className="text-[11px] rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 px-3 py-1.5 font-medium transition"
              >
                {saving ? "Saving…" : "Save property"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
