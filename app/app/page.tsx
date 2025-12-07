// app/page.tsx
"use client";

import { useState, useEffect } from "react";
import { UploadCard } from "@/components/UploadCard";
import {
  StyleSelector,
  ROOM_STYLES,
  RoomStyleId,
} from "@/components/StyleSelector";
import { GeneratePanel } from "@/components/GeneratePanel";
import { ResultPanel } from "@/components/ResultPanel";
import { JobsHistory } from "@/components/JobsHistory";
import { AuthPanel } from "@/components/AuthPanel";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { RealtorHeader } from "@/components/RealtorHeader";
import { PropertiesSection } from "@/components/PropertiesSection";
import { useSearchParams, useRouter } from "next/navigation";
import { PhotoToolsPanel } from "@/components/PhotoToolsPanel";
import { SurfaceToolsPanel } from "@/components/SurfaceToolsPanel";

// 🔹 NEW: RoomType type for the dropdown
type RoomType =
  | "auto"
  | "living-room"
  | "family-room"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "dining-room"
  | "office-den"
  | "other";

export default function Home() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<RoomStyleId | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // Phase 1: agent photo tools
  const [enhancePhoto, setEnhancePhoto] = useState(false);
  const [cleanupRoom, setCleanupRoom] = useState(false);
  const [repairDamage, setRepairDamage] = useState(false);
  const [emptyRoom, setEmptyRoom] = useState(false);
  const [renovateRoom, setRenovateRoom] = useState(false);

  // Phase 2: surfaces
  const [repaintWalls, setRepaintWalls] = useState(false);
  const [flooringPreset, setFlooringPreset] = useState<
    "" | "carpet" | "hardwood" | "tile"
  >(""); // "" = no flooring change

  // 🔹 NEW: Room type selection (front-end only for now)
  const [roomType, setRoomType] = useState<RoomType>("auto");

  // property + room state
  const [properties, setProperties] = useState<
    { id: string; title: string | null; address_line_1: string | null }[]
  >([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | "">("");
  const [roomName, setRoomName] = useState("");

  const [propertiesRefreshToken, setPropertiesRefreshToken] = useState(0);
  const [jobsRefreshToken, setJobsRefreshToken] = useState(0);

  // track deep-link consumption so we don't re-apply it forever
  const [consumedDeepLinkJobId, setConsumedDeepLinkJobId] = useState<
    string | null
  >(null);

  const { user, loading: authLoading } = useSupabaseUser();

  // Tools that count as "doing something" even without a style
  const wantsPhotoTools =
    enhancePhoto ||
    cleanupRoom ||
    repairDamage ||
    emptyRoom ||
    renovateRoom ||
    repaintWalls ||
    flooringPreset !== "";

  // Property + room NOT required anymore for canGenerate
  const canGenerate = Boolean(
    uploadedFile && user && (selectedStyle || wantsPhotoTools)
  );

  // Load properties for the selector
  useEffect(() => {
    const loadPropertiesForSelector = async () => {
      if (authLoading) return;

      if (!user) {
        setProperties([]);
        setPropertiesLoading(false);
        return;
      }

      setPropertiesLoading(true);
      try {
        const { data, error } = await supabase
          .from("properties")
          .select("id, title, address_line_1")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false });

        if (error) {
          console.error("[Home] load properties error:", error);
          setProperties([]);
        } else {
          setProperties(data ?? []);
        }
      } catch (err) {
        console.error("[Home] unexpected properties load error:", err);
        setProperties([]);
      } finally {
        setPropertiesLoading(false);
      }
    };

    loadPropertiesForSelector();
  }, [authLoading, user?.id, supabase]);

  // Handle deep-links from Properties page:
  // ?propertyId=...&room=...  (new)
  // ?property=...             (legacy)
  useEffect(() => {
    const propertyFromURL =
      searchParams.get("propertyId") || searchParams.get("property");
    const roomFromURL = searchParams.get("room");

    if (propertyFromURL) {
      setSelectedPropertyId(propertyFromURL);
    }

    if (roomFromURL) {
      setRoomName(roomFromURL);
    }

    if (propertyFromURL || roomFromURL) {
      const el = document.getElementById("staging-area");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [searchParams]);

  // Handle file upload + preview
  const handleFileChange = (file: File | null) => {
    setUploadedFile(file);
    setResultUrl(null); // clear previous result when new file chosen

    if (file) {
      const url = URL.createObjectURL(file);
      setUploadedPreview(url);
    } else {
      setUploadedPreview(null);
    }
  };

  // Helper: re-use existing "Untitled property" if present, otherwise create one
  const ensurePropertyForJob = async (): Promise<string | null> => {
    if (selectedPropertyId) return selectedPropertyId;

    if (!user) {
      alert("You must be logged in to create a new property.");
      return null;
    }

    // 1) Check local state for an existing Untitled property
    const localUntitled = properties.find(
      (p) => (p.title ?? "").trim().toLowerCase() === "untitled property"
    );
    if (localUntitled) {
      setSelectedPropertyId(localUntitled.id);
      return localUntitled.id;
    }

    // 2) Check Supabase for an existing Untitled property
    try {
      const { data: existingData, error: existingError } = await supabase
        .from("properties")
        .select("id, title, address_line_1")
        .eq("user_id", user.id)
        .ilike("title", "untitled property")
        .limit(1)
        .maybeSingle();

      if (existingError && (existingError as any).code !== "PGRST116") {
        // ignore "No rows" but log other errors
        console.error(
          "[Home] error while searching for existing Untitled property:",
          existingError
        );
      }

      if (existingData) {
        const existingId = existingData.id as string;

        // Add to local list if missing
        setProperties((prev) => {
          const alreadyThere = prev.some((p) => p.id === existingId);
          if (alreadyThere) return prev;
          return [
            {
              id: existingId,
              title: existingData.title,
              address_line_1: existingData.address_line_1,
            },
            ...prev,
          ];
        });

        setSelectedPropertyId(existingId);
        return existingId;
      }
    } catch (err) {
      console.error(
        "[Home] unexpected error while searching for existing Untitled property:",
        err
      );
      // fall through to create a new one
    }

    // 3) No existing Untitled found; create a new one
    try {
      const { data, error } = await supabase
        .from("properties")
        .insert({
          user_id: user.id,
          title: "Untitled property",
        })
        .select("id, title, address_line_1")
        .single();

      if (error || !data) {
        console.error("[Home] auto-create property error:", error);
        alert("Failed to create a new property. Please try again.");
        return null;
      }

      const newId = data.id as string;

      // Update local selector list
      setProperties((prev) => [
        {
          id: newId,
          title: data.title,
          address_line_1: data.address_line_1,
        },
        ...prev,
      ]);
      setSelectedPropertyId(newId);

      // Tell PropertiesSection to re-fetch its own list
      setPropertiesRefreshToken((t) => t + 1);

      return newId;
    } catch (err) {
      console.error("[Home] unexpected auto-create property error:", err);
      alert("Unexpected error creating a new property.");
      return null;
    }
  };

  // Shared blob-based downloader for staged images (same behavior as property page)
  const handleDownloadUrl = async (url: string | null) => {
    if (!url) return;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          "[Home] download fetch error:",
          response.status,
          response.statusText
        );
        alert("Could not download image. Check console for details.");
        return;
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "roomprintz-image.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("[Home] unexpected download error:", err);
      alert("Unexpected error while downloading image.");
    }
  };

  // 🔁 Reuse a staged (or original) image as the new input upload
  const handleUseImageAsNewInput = async (imageUrl: string | null) => {
    if (!imageUrl) return;

    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        console.error(
          "[Home] fetch image for re-upload failed:",
          response.status,
          response.statusText
        );
        alert("Could not reuse this image. Check console for details.");
        return;
      }

      const blob = await response.blob();
      const fileName = "roomprintz-input-from-history.png";

      const file = new File([blob], fileName, {
        type: blob.type || "image/png",
      });

      // Reuse existing upload logic so tools + preview behave identically
      handleFileChange(file);

      // Scroll back to staging area for nice UX
      const el = document.getElementById("staging-area");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (err) {
      console.error("[Home] unexpected error reusing image:", err);
      alert("Unexpected error using this image as a new input.");
    }
  };

  // 🔗 Auto-load from deep-link: ?fromJobId=...&fromOriginal=1
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    const fromJobId = searchParams.get("fromJobId");
    const fromOriginalParam = searchParams.get("fromOriginal");
    const fromOriginal = fromOriginalParam === "1";

    if (!fromJobId) return;
    if (consumedDeepLinkJobId === fromJobId) return;

    const applyDeepLink = async () => {
      try {
        const { data: job, error } = await supabase
          .from("jobs")
          .select(
            "id, staged_image_url, original_image_url, property_id, room_name"
          )
          .eq("id", fromJobId)
          .maybeSingle();

        if (error) {
          console.error("[Home] deep-link job fetch error:", error);
          return;
        }

        if (!job) {
          console.warn("[Home] deep-link job not found for id:", fromJobId);
          return;
        }

        // If property/room not already set via query, fall back to job's values
        const propertyFromURL =
          searchParams.get("propertyId") || searchParams.get("property");
        const roomFromURL = searchParams.get("room");

        if (!propertyFromURL && job.property_id) {
          setSelectedPropertyId(job.property_id as string);
        }

        if (!roomFromURL && job.room_name) {
          setRoomName(job.room_name as string);
        }

        // Pick which image to use
        const chosenUrl = fromOriginal
          ? (job.original_image_url as string | null)
          : (job.staged_image_url as string | null);

        if (!chosenUrl) {
          console.warn(
            "[Home] deep-link job has no suitable image url:",
            job.id
          );
          return;
        }

        await handleUseImageAsNewInput(chosenUrl);

        setConsumedDeepLinkJobId(fromJobId);

        // Clean URL so we don't re-apply on refresh/back
        const qs = new URLSearchParams(searchParams.toString());
        qs.delete("fromJobId");
        qs.delete("fromOriginal");

        const qsString = qs.toString();
        const hash = "#staging-area";

        // Keep current pathname; only change query/hash
        if (qsString) {
          router.replace(`?${qsString}${hash}`);
        } else {
          router.replace(hash);
        }
      } catch (err) {
        console.error("[Home] unexpected deep-link apply error:", err);
      }
    };

    applyDeepLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, authLoading, user, consumedDeepLinkJobId]);

  const handleGenerate = async () => {
    if (!uploadedFile) {
      alert("Please upload a room photo first.");
      return;
    }

    if (!user) {
      alert("You must be logged in to generate rooms.");
      return;
    }

    if (!selectedStyle && !wantsPhotoTools) {
      alert("Please select a staging style or at least one photo tool.");
      return;
    }

    try {
      setIsGenerating(true);
      setResultUrl(null);

      // 1) Ensure we have a property (auto-create Untitled if needed)
      const effectivePropertyId = await ensurePropertyForJob();
      if (!effectivePropertyId) {
        setIsGenerating(false);
        return;
      }

      // 2) Decide room name (auto “Untitled room” if blank)
      const effectiveRoomName =
        roomName.trim().length > 0 ? roomName.trim() : "Untitled room";
      if (!roomName.trim()) {
        setRoomName(effectiveRoomName);
      }

      // 3) Generate a jobId so our storage paths are stable
      const jobId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // 4) Upload ORIGINAL to Supabase Storage (room-originals bucket)
      const extFromName =
        (uploadedFile.name.split(".").pop() || "jpg").toLowerCase();
      const originalExt = extFromName === "jpeg" ? "jpg" : extFromName;
      const originalPath = `${user.id}/${effectivePropertyId}/${jobId}.${originalExt}`;

      const { error: originalUploadError } = await supabase.storage
        .from("room-originals")
        .upload(originalPath, uploadedFile, {
          upsert: true,
        });

      if (originalUploadError) {
        console.error("[Home] original upload error:", originalUploadError);
        alert(
          "Failed to upload the original room photo to storage. Please try again."
        );
        return;
      }

      const { data: originalUrlData } = supabase.storage
        .from("room-originals")
        .getPublicUrl(originalPath);
      const originalImageUrl = originalUrlData.publicUrl;

      // 5) Call compositor API (FastAPI via /api/stage-room) to generate staged image
      const formData = new FormData();
      formData.append("file", uploadedFile);
      if (selectedStyle) formData.append("styleId", selectedStyle);

      formData.append("enhancePhoto", enhancePhoto ? "true" : "false");
      formData.append("cleanupRoom", cleanupRoom ? "true" : "false");
      formData.append("repairDamage", repairDamage ? "true" : "false");
      formData.append("emptyRoom", emptyRoom ? "true" : "false");
      formData.append("renovateRoom", renovateRoom ? "true" : "false");
      formData.append("repaintWalls", repaintWalls ? "true" : "false");
      formData.append("flooringPreset", flooringPreset || "none");

      // 🔗 NEW: pass roomType through (auto ⇒ blank / null)
      formData.append(
        "roomType",
        roomType === "auto" ? "" : roomType
      );

      const response = await fetch("/api/stage-room", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error(
          "Stage-room API error:",
          response.status,
          response.statusText,
          text
        );
        throw new Error("Failed to generate staged room");
      }

      const data: { imageUrl?: string; error?: string } = await response.json();

      if (data.error) {
        console.error("Stage-room API returned error:", data.error);
        throw new Error(data.error);
      }

      const compositedDataUrl = data.imageUrl;

      if (!compositedDataUrl) {
        console.error("[Home] compositor returned no imageUrl");
        throw new Error("Compositor did not return an imageUrl");
      }

      // 6) Upload STAGED image to Supabase Storage (room-staged bucket)
      const stagedResponse = await fetch(compositedDataUrl);
      const stagedBlob = await stagedResponse.blob();
      const stagedMime = stagedBlob.type || "image/png";
      const stagedExt =
        stagedMime === "image/jpeg"
          ? "jpg"
          : stagedMime === "image/png"
          ? "png"
          : "png";

      const stagedPath = `${user.id}/${effectivePropertyId}/${jobId}.${stagedExt}`;

      const { error: stagedUploadError } = await supabase.storage
        .from("room-staged")
        .upload(stagedPath, stagedBlob, {
          upsert: true,
          contentType: stagedMime,
        });

      if (stagedUploadError) {
        console.error("[Home] staged upload error:", stagedUploadError);
        alert(
          "Failed to upload the staged image to storage. Please try again."
        );
        return;
      }

      const { data: stagedUrlData } = supabase.storage
        .from("room-staged")
        .getPublicUrl(stagedPath);
      const stagedImageUrl = stagedUrlData.publicUrl;

      if (!stagedImageUrl) {
        throw new Error("Could not obtain public URL for staged image");
      }

      // 7) Update UI with staged URL
      setResultUrl(stagedImageUrl);

      // 8) Save job to Supabase (URLs only, no base64)
      try {
        const { data: insertData, error: insertError } = await supabase
          .from("jobs")
          .insert({
            id: jobId,
            style_id: selectedStyle,
            staged_image_url: stagedImageUrl,
            original_image_url: originalImageUrl,
            user_id: user.id,
            property_id: effectivePropertyId,
            room_name: effectiveRoomName,
          })
          .select("id")
          .single();

        if (insertError) {
          console.error("[Supabase jobs insert] error:", insertError);
        } else {
          console.log("[Supabase jobs insert] inserted job id:", insertData?.id);
          setJobsRefreshToken((token) => token + 1);
        }
      } catch (err) {
        console.error("[Supabase jobs insert] unexpected error:", err);
      }
    } catch (err) {
      console.error("Generate error:", err);
      alert(
        "Something went wrong generating the staged room. Check console for details."
      );
      if (uploadedPreview) {
        setResultUrl(uploadedPreview);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50 flex flex-col">
      {/* Top header */}
      <header className="border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 font-bold text-lg">
              RP
            </div>
            <div>
              <div className="font-semibold tracking-tight">RoomPrintz</div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                Proptech Beta
              </div>
            </div>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-slate-800 text-slate-300">
            Private Beta • For trusted agents only
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
          <AuthPanel />

          <RealtorHeader />

          <PropertiesSection refreshToken={propertiesRefreshToken} />

          {/* Hero text */}
          <section className="space-y-2">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              AI-Powered Real Estate Staging
            </h1>
            <p className="text-slate-300 max-w-2xl">
              Upload any room, choose a style, and generate listing-ready staged
              interiors in seconds. This beta is powered by the PetPrintz
              Compositor Engine™.
            </p>
          </section>

          {/* Property & Room selector */}
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs flex flex-col md:flex-row md:items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] text-slate-400 mb-1">
                Property
              </label>
              {authLoading ? (
                <div className="text-[11px] text-slate-500">
                  Loading your properties…
                </div>
              ) : !user ? (
                <div className="text-[11px] text-slate-500">
                  Log in to select a property.
                </div>
              ) : propertiesLoading ? (
                <div className="text-[11px] text-slate-500">
                  Loading your properties…
                </div>
              ) : properties.length === 0 ? (
                <div className="text-[11px] text-slate-500">
                  You don&apos;t have any properties yet. Use &quot;New
                  property&quot; above to create one, then come back here to
                  stage rooms.
                </div>
              ) : (
                <select
                  value={selectedPropertyId}
                  onChange={(e) => setSelectedPropertyId(e.target.value)}
                  className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="">Select a property…</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title || p.address_line_1 || "Untitled property"}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex-1">
              <label className="block text-[11px] text-slate-400 mb-1">
                Room name
              </label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                placeholder="Living Room, Kitchen, Primary Bedroom..."
              />
            </div>
          </section>

          {/* Three-column layout */}
          <section
            id="staging-area"
            className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start"
          >
            {/* LEFT COLUMN: Upload + tools */}
            <div className="space-y-4">
              <UploadCard
                file={uploadedFile}
                previewUrl={uploadedPreview}
                onFileChange={handleFileChange}
              />

              {uploadedFile && (
                <>
                  <PhotoToolsPanel
                    enhancePhoto={enhancePhoto}
                    onChangeEnhance={setEnhancePhoto}
                    cleanupRoom={cleanupRoom}
                    onChangeCleanup={setCleanupRoom}
                    repairDamage={repairDamage}
                    onChangeRepair={setRepairDamage}
                    emptyRoom={emptyRoom}
                    onChangeEmptyRoom={setEmptyRoom}
                    renovateRoom={renovateRoom}
                    onChangeRenovateRoom={setRenovateRoom}
                  />

                  <SurfaceToolsPanel
                    repaintWalls={repaintWalls}
                    onChangeRepaintWalls={setRepaintWalls}
                    flooringPreset={flooringPreset}
                    onChangeFlooringPreset={setFlooringPreset}
                  />
                </>
              )}
            </div>

            {/* CENTER COLUMN: Style selection + Room Type */}
            <div className="space-y-4">
              <StyleSelector
                styles={ROOM_STYLES}
                selectedStyle={selectedStyle}
                onSelectStyle={setSelectedStyle}
              />

              {/* 🔹 NEW: Room Type dropdown */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-3 text-xs">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-200">
                      Room type
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Help the AI stage the right type of room (optional).
                    </div>
                  </div>
                </div>
                <select
                  value={roomType}
                  onChange={(e) => setRoomType(e.target.value as RoomType)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                >
                  <option value="auto">Auto-detect room type (default)</option>
                  <option value="living-room">Living Room</option>
                  <option value="family-room">Family Room</option>
                  <option value="bedroom">Bedroom</option>
                  <option value="kitchen">Kitchen</option>
                  <option value="bathroom">Bathroom</option>
                  <option value="dining-room">Dining Room</option>
                  <option value="office-den">Office / Den</option>
                  <option value="other">Other / Flex Room</option>
                </select>
              </div>
            </div>

            {/* RIGHT COLUMN: Result + Generate */}
            <div className="space-y-4">
              <ResultPanel
                uploadedPreview={uploadedPreview}
                resultUrl={resultUrl}
                selectedStyle={selectedStyle}
                isGenerating={isGenerating}
                onDownload={handleDownloadUrl}
                onUseAsNewInput={handleUseImageAsNewInput}
              />

              <GeneratePanel
                canGenerate={canGenerate}
                isGenerating={isGenerating}
                onGenerate={handleGenerate}
              />
            </div>
          </section>

          <JobsHistory
            refreshToken={jobsRefreshToken}
            onUseAsNewInput={handleUseImageAsNewInput}
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between text-xs text-slate-500">
          <span>RoomPrintz™ • Powered by the PetPrintz Compositor Engine™</span>
          <span>Private Beta · 2025</span>
        </div>
      </footer>
    </main>
  );
}
