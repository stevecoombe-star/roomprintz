// app/app/properties/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { useSupabaseUser } from "@/lib/useSupabaseUser";
import { ROOM_STYLES } from "@/components/StyleSelector";

type Property = {
  id: string;
  title: string | null;
  address_line_1: string | null;
  city: string | null;
  state_province: string | null;
  postal_code: string | null;
  mls_number: string | null;
  notes: string | null;
  updated_at: string;
  main_image_url: string | null;
};

type Job = {
  id: string;
  staged_image_url: string | null; // now nullable to allow blank rooms
  style_id: string | null;
  room_name: string | null;
  created_at: string;
  original_image_url: string | null;
  is_primary_for_room: boolean | null;
  room_notes: string | null;
};

export default function PropertyPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useSupabaseUser();

  const propertyId = params?.id as string | undefined;

  const [property, setProperty] = useState<Property | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingMainImage, setUploadingMainImage] = useState(false);

  // NEW: bulk upload originals
  const bulkFileInputRef = useRef<HTMLInputElement | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);

  // modal + actions
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [jobActionLoading, setJobActionLoading] = useState(false);

  // full-view modal navigation within a room
  const [modalRoomJobs, setModalRoomJobs] = useState<Job[]>([]);
  const [modalIndex, setModalIndex] = useState(0);

  // room sorting
  const [roomSort, setRoomSort] = useState<"alpha" | "recent">("alpha");

  // accordion open/closed rooms
  const [openRooms, setOpenRooms] = useState<string[]>([]);
  // const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // room rename inline editing
  const [editingRoom, setEditingRoom] = useState<string | null>(null);
  const [editingRoomValue, setEditingRoomValue] = useState("");
  const [roomRenameLoading, setRoomRenameLoading] = useState(false);

  // room notes editing
  const [editingNotesRoom, setEditingNotesRoom] = useState<string | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState("");
  const [roomNotesLoading, setRoomNotesLoading] = useState(false);

  // delete property
  const [propertyDeleting, setPropertyDeleting] = useState(false);

  // edit property modal + form
  const [editingProperty, setEditingProperty] = useState(false);
  const [propertySaving, setPropertySaving] = useState(false);
  const [propertyForm, setPropertyForm] = useState({
    title: "",
    address_line_1: "",
    city: "",
    state_province: "",
    postal_code: "",
    mls_number: "",
    notes: "",
  });

  // move image to another room
  const [moveJob, setMoveJob] = useState<Job | null>(null);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveExistingRoomLabel, setMoveExistingRoomLabel] =
    useState<string>("");
  const [moveNewRoomLabel, setMoveNewRoomLabel] = useState<string>("");

  // ------------ LOAD PROPERTY + JOBS ------------

  useEffect(() => {
    const loadData = async () => {
      if (authLoading) return;
      if (!user) {
        router.push("/");
        return;
      }
      if (!propertyId) return;

      setLoading(true);
      setErrorMessage(null);

      try {
        // Load property
        const { data: propertyData, error: propertyError } = await supabase
          .from("properties")
          .select(
            "id, title, address_line_1, city, state_province, postal_code, mls_number, notes, updated_at, main_image_url"
          )
          .eq("id", propertyId)
          .maybeSingle();

        if (propertyError) {
          console.error("[PropertyPage] property error:", propertyError);
          setErrorMessage(propertyError.message);
          setProperty(null);
        } else if (!propertyData) {
          setErrorMessage("Property not found.");
          setProperty(null);
        } else {
          setProperty(propertyData as Property);
        }

        // Load jobs for this property
        const { data: jobsData, error: jobsError } = await supabase
          .from("jobs")
          .select(
            "id, staged_image_url, style_id, room_name, created_at, original_image_url, is_primary_for_room, room_notes"
          )
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false });

        if (jobsError) {
          console.error("[PropertyPage] jobs error:", jobsError);
        } else {
          setJobs((jobsData ?? []) as Job[]);
        }
      } catch (err: any) {
        console.error("[PropertyPage] unexpected error:", err);
        setErrorMessage(err?.message ?? "Unexpected error loading property.");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [authLoading, user, propertyId, router]);

  // ---------- list of all room labels (for move dialog) ----------

  const allRoomLabels = useMemo(() => {
    const set = new Set<string>();
    for (const job of jobs) {
      const key = job.room_name?.trim() || "Unlabeled room";
      set.add(key);
    }
    const labels = Array.from(set);
    labels.sort((a, b) => {
      const aIsUnlabeled = a === "Unlabeled room";
      const bIsUnlabeled = b === "Unlabeled room";
      if (aIsUnlabeled && !bIsUnlabeled) return 1;
      if (!aIsUnlabeled && bIsUnlabeled) return -1;
      return a.localeCompare(b);
    });
    return labels;
  }, [jobs]);

  // ---------- sorted rooms (group + sort by alpha / recent) ----------

  const sortedRooms = useMemo(() => {
    const byRoom = new Map<string, Job[]>();

    for (const job of jobs) {
      const key = job.room_name?.trim() || "Unlabeled room";
      if (!byRoom.has(key)) {
        byRoom.set(key, []);
      }
      byRoom.get(key)!.push(job);
    }

    const entries = Array.from(byRoom.entries()).map(([roomName, roomJobs]) => {
      const latestCreatedAt =
        roomJobs
          .map((j) => j.created_at)
          .sort()
          .slice(-1)[0] ?? "";

      // All staged jobs, oldest → newest (only those with staged_image_url)
      const stagedJobs = roomJobs
        .filter((j) => j.staged_image_url)
        .slice()
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime()
        );
      const latestStaged =
        stagedJobs.length > 0
          ? stagedJobs[stagedJobs.length - 1]
          : undefined;

      // earliest original in this room
      const originalJob =
        roomJobs
          .filter(
            (j) =>
              j.original_image_url &&
              !j.original_image_url.startsWith("blob:")
          )
          .slice()
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          )[0] || null;

      // User-chosen primary job for this room (if any)
      const primaryJob = roomJobs.find((j) => j.is_primary_for_room);

      // Decide primary image for header thumbnail:
      // 1) If user picked one: use its staged image, else original
      // 2) Else: latest staged
      // 3) Else: original
      let primaryImageUrl: string | null = null;

      if (primaryJob) {
        primaryImageUrl =
          primaryJob.staged_image_url ||
          primaryJob.original_image_url ||
          null;
      } else if (latestStaged) {
        primaryImageUrl = latestStaged.staged_image_url;
      } else if (originalJob?.original_image_url) {
        primaryImageUrl = originalJob.original_image_url;
      }

      // Room-level notes: any non-empty notes in this room
      const roomNotes =
        roomJobs.find((j) => j.room_notes && j.room_notes.trim().length > 0)
          ?.room_notes ?? null;

      // Count only real images (original or staged), ignore placeholder rows
      const imageCount = roomJobs.filter(
        (j) => j.staged_image_url || j.original_image_url
      ).length;

      return {
        roomName,
        jobs: roomJobs,
        latestCreatedAt,
        primaryImageUrl,
        roomNotes,
        imageCount,
      };
    });

    entries.sort((a, b) => {
      if (roomSort === "alpha") {
        const aIsUnlabeled = a.roomName === "Unlabeled room";
        const bIsUnlabeled = b.roomName === "Unlabeled room";
        if (aIsUnlabeled && !bIsUnlabeled) return 1;
        if (!aIsUnlabeled && bIsUnlabeled) return -1;
        return a.roomName.localeCompare(b.roomName);
      } else {
        if (a.latestCreatedAt === b.latestCreatedAt) return 0;
        return a.latestCreatedAt < b.latestCreatedAt ? 1 : -1;
      }
    });

    return entries;
  }, [jobs, roomSort]);

  // ---------- BULK UPLOAD ORIGINAL PHOTOS ----------

  const handleOpenBulkUpload = () => {
    if (!property || !user) {
      alert("You must be logged in and viewing a valid property.");
      return;
    }
    if (bulkUploading) return;
    bulkFileInputRef.current?.click();
  };

  const handleBulkOriginalsSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    if (!property || !user) {
      e.target.value = "";
      return;
    }

    const files = Array.from(fileList);

    setBulkUploading(true);
    setErrorMessage(null);

    try {
      // Build set of existing room labels (UI labels)
      const existingRoomLabels = new Set(sortedRooms.map((r) => r.roomName));

      const allocateRoomName = () => {
        let index = 1;

        // 🔹 NEW: always work with zero-padded labels: Room 01, Room 02, ...
        const makeLabel = (i: number) => `Room ${String(i).padStart(2, "0")}`;

        // 🔹 Skip any indices that already exist (e.g., Room 01, Room 02...)
        while (existingRoomLabels.has(makeLabel(index))) {
          index += 1;
        }

        const label = makeLabel(index);
        existingRoomLabels.add(label);
        return label;
      };

      const createdJobs: Job[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split(".").pop() || "jpg";
        const safeExt = ext.toLowerCase().split("?")[0].split("#")[0];

        const path = `${user.id}/${property.id}/original-${Date.now()}-${i}.${safeExt}`;

        const { error: uploadError } = await supabase.storage
          .from("room-originals")
          .upload(path, file, {
            upsert: true,
          });

        if (uploadError) {
          console.error(
            "[PropertyPage] bulk original upload error:",
            uploadError
          );
          alert(
            `Failed to upload one of the photos (${file.name}). Check console for details.`
          );
          continue;
        }

        const { data: publicUrlData } = supabase.storage
          .from("room-originals")
          .getPublicUrl(path);

        const originalUrl = publicUrlData.publicUrl;

        const roomName = allocateRoomName();

        const { data, error: insertError } = await supabase
          .from("jobs")
          .insert({
            user_id: user.id,
            property_id: property.id,
            room_name: roomName,
            style_id: null,
            staged_image_url: "",
            original_image_url: originalUrl,
            room_notes: null,
            is_primary_for_room: true,
          })
          .select(
            "id, staged_image_url, style_id, room_name, created_at, original_image_url, is_primary_for_room, room_notes"
          )
          .single();

        if (insertError) {
          console.error(
            "[PropertyPage] bulk original insert error:",
            insertError
          );
          alert(
            `Uploaded a photo but could not attach it to this property (${file.name}). Check console for details.`
          );
          continue;
        }

        createdJobs.push(data as Job);
      }

      if (createdJobs.length > 0) {
        setJobs((prev: Job[]) => [...prev, ...createdJobs]);

        // Open all the newly-created rooms in the accordion
        const newLabels = createdJobs
          .map((j) => j.room_name?.trim() || "Unlabeled room")
          .filter((label) => !!label);

        setOpenRooms((prev: string[]) => {
          const next = new Set(prev);
          for (const label of newLabels) {
            next.add(label);
          }
          return Array.from(next);
        });
      }
    } catch (err: any) {
      console.error(
        "[PropertyPage] unexpected bulk original upload error:",
        err
      );
      alert("Unexpected error while uploading photos.");
    } finally {
      setBulkUploading(false);
      if (e.target) {
        e.target.value = "";
      }
    }
  };

  // Auto-open the first room only once on initial load
  // useEffect(() => {
  //   if (!hasAutoOpened && sortedRooms.length > 0) {
  //     setOpenRooms([sortedRooms[0].roomName]);
  //     setHasAutoOpened(true);
  //   }
  // }, [sortedRooms, hasAutoOpened]);

  const handleExpandAllRooms = () => {
    setOpenRooms(sortedRooms.map((r) => r.roomName));
  };

  const handleCollapseAllRooms = () => {
    setOpenRooms([]);
  };

  const toggleRoomOpen = (roomName: string) => {
    setOpenRooms((prev: string[]) =>
      prev.includes(roomName)
        ? prev.filter((name) => name !== roomName)
        : [...prev, roomName]
    );
  };

  // ------------ CREATE BLANK ROOM ------------

  const handleCreateBlankRoom = async () => {
    if (!propertyId || !user) {
      alert("You must be logged in and viewing a valid property.");
      return;
    }

    const input = window.prompt("New room name", "New room");
    if (input === null) return; // user cancelled

    const roomName = input.trim();
    if (!roomName) {
      alert("Room name cannot be empty.");
      return;
    }

    // If a room with this label already exists, just open it
    const existingRoom = sortedRooms.find((r) => r.roomName === roomName);
    if (existingRoom) {
      setOpenRooms((prev) =>
        prev.includes(roomName) ? prev : [...prev, roomName]
      );
      return;
    }

    try {
      setJobActionLoading(true);

      const { data, error } = await supabase
        .from("jobs")
        .insert({
          user_id: user.id,
          property_id: propertyId,
          room_name: roomName,
          style_id: null,
          // DB columns are NOT NULL → use empty string as placeholder
          staged_image_url: "",
          original_image_url: "",
          room_notes: null,
          is_primary_for_room: false,
        })
        .select(
          "id, staged_image_url, style_id, room_name, created_at, original_image_url, is_primary_for_room, room_notes"
        )
        .single();

      if (error) {
        console.error("[PropertyPage] create blank room error:", error);
        alert("Failed to create a blank room. Check console for details.");
        return;
      }

      const newJob = data as Job;

      // Add to local jobs so UI updates immediately
      setJobs((prev: Job[]) => [...prev, newJob]);

      // Open this new room accordion
      const key = roomName || "Unlabeled room";
      setOpenRooms((prev) =>
        prev.includes(key) ? prev : [...prev, key]
      );
    } catch (err) {
      console.error("[PropertyPage] unexpected create blank room error:", err);
      alert("Unexpected error creating a blank room.");
    } finally {
      setJobActionLoading(false);
    }
  };

  // ------------ ROOM RENAME HELPERS ------------

  const startRenameRoom = (roomLabel: string) => {
    setEditingRoom(roomLabel);
    setEditingRoomValue(roomLabel === "Unlabeled room" ? "" : roomLabel);
  };

  const cancelRenameRoom = () => {
    setEditingRoom(null);
    setEditingRoomValue("");
  };

  const saveRenameRoom = async (roomLabel: string) => {
    if (!propertyId) return;

    const newLabelTrimmed = editingRoomValue.trim();

    // Map empty string to "Unlabeled room" for UI
    const effectiveNewLabel =
      newLabelTrimmed === "" ? "Unlabeled room" : newLabelTrimmed;

    // If nothing changed, just cancel
    if (effectiveNewLabel === roomLabel) {
      cancelRenameRoom();
      return;
    }

    // Map UI labels to DB values
    const oldDbValue = roomLabel === "Unlabeled room" ? null : roomLabel;
    const newDbValue =
      newLabelTrimmed.length === 0 ? null : newLabelTrimmed;

    try {
      setRoomRenameLoading(true);

      // Update all jobs for this property + room
      let updateQuery = supabase
        .from("jobs")
        .update({ room_name: newDbValue })
        .eq("property_id", propertyId);

      if (oldDbValue === null) {
        updateQuery = updateQuery.is("room_name", null);
      } else {
        updateQuery = updateQuery.eq("room_name", oldDbValue);
      }

      const { error } = await updateQuery;
      if (error) {
        console.error("[PropertyPage] room rename error:", error);
        alert("Failed to rename room. Check console for details.");
        return;
      }

      // Update local jobs
      setJobs((prev: Job[]) =>
        prev.map((job) => {
          const key = job.room_name?.trim() || "Unlabeled room";
          if (key !== roomLabel) return job;
          return { ...job, room_name: newDbValue };
        })
      );

      // Update openRooms keys
      setOpenRooms((prev: string[]) =>
        prev.map((name) =>
          name === roomLabel ? effectiveNewLabel : name
        )
      );

      cancelRenameRoom();
    } catch (err) {
      console.error("[PropertyPage] unexpected room rename error:", err);
      alert("Unexpected error renaming room.");
    } finally {
      setRoomRenameLoading(false);
    }
  };

  // ------------ ROOM NOTES HELPERS ------------

  const startEditRoomNotes = (
    roomLabel: string,
    currentNotes: string | null
  ) => {
    setEditingNotesRoom(roomLabel);
    setEditingNotesValue(currentNotes ?? "");
  };

  const cancelEditRoomNotes = () => {
    setEditingNotesRoom(null);
    setEditingNotesValue("");
  };

  const saveRoomNotes = async (roomLabel: string) => {
    if (!propertyId) return;

    const newNotesTrimmed = editingNotesValue.trim();
    const newNotesValue = newNotesTrimmed === "" ? null : newNotesTrimmed;

    // Map UI label -> DB room_name
    const roomDbValue = roomLabel === "Unlabeled room" ? null : roomLabel;

    try {
      setRoomNotesLoading(true);

      let updateQuery = supabase
        .from("jobs")
        .update({ room_notes: newNotesValue })
        .eq("property_id", propertyId);

      if (roomDbValue === null) {
        updateQuery = updateQuery.is("room_name", null);
      } else {
        updateQuery = updateQuery.eq("room_name", roomDbValue);
      }

      const { error } = await updateQuery;
      if (error) {
        console.error("[PropertyPage] room notes save error:", error);
        alert("Failed to save room notes. Check console for details.");
        return;
      }

      // Update local state: apply new notes to all jobs in this room
      setJobs((prev: Job[]) =>
        prev.map((job) => {
          const key = job.room_name?.trim() || "Unlabeled room";
          if (key !== roomLabel) return job;
          return { ...job, room_notes: newNotesValue };
        })
      );

      cancelEditRoomNotes();
    } catch (err) {
      console.error("[PropertyPage] unexpected room notes error:", err);
      alert("Unexpected error saving room notes.");
    } finally {
      setRoomNotesLoading(false);
    }
  };

  const clearRoomNotes = async (roomLabel: string) => {
    setEditingNotesValue("");
    await saveRoomNotes(roomLabel);
  };

  // ------------ MOVE IMAGE TO ANOTHER ROOM HELPERS ------------

  const startMoveJob = (job: Job, currentRoomLabel: string) => {
    const availableTargets = allRoomLabels.filter(
      (label) => label !== currentRoomLabel
    );
    setMoveExistingRoomLabel(availableTargets[0] ?? "");
    setMoveNewRoomLabel("");
    setMoveJob(job);
    setMoveDialogOpen(true);
  };

  const cancelMoveJob = () => {
    if (moveSaving) return;
    setMoveDialogOpen(false);
    setMoveJob(null);
    setMoveExistingRoomLabel("");
    setMoveNewRoomLabel("");
  };

  const handleConfirmMoveJob = async () => {
    if (!moveJob) return;
    if (!propertyId) return;

    const currentRoomLabel =
      moveJob.room_name?.trim() || "Unlabeled room";

    const newLabelTrimmed = moveNewRoomLabel.trim();
    const fallbackLabel = moveExistingRoomLabel.trim();

    const targetLabel =
      newLabelTrimmed.length > 0 ? newLabelTrimmed : fallbackLabel;

    if (!targetLabel) {
      alert("Please select an existing room or enter a new room name.");
      return;
    }

    // Map target room label → DB value
    const targetDbValue =
      targetLabel === "Unlabeled room" ? null : targetLabel;

    try {
      setMoveSaving(true);

      const { error } = await supabase
        .from("jobs")
        .update({ room_name: targetDbValue })
        .eq("id", moveJob.id);

      if (error) {
        console.error("[PropertyPage] move image error:", error);
        alert("Failed to move image. Check console for details.");
        return;
      }

      // Update local jobs: move only this job
      setJobs((prev: Job[]) =>
        prev.map((job) =>
          job.id === moveJob.id ? { ...job, room_name: targetDbValue } : job
        )
      );

      // Ensure new room accordion is open
      const uiTargetLabel = targetLabel || "Unlabeled room";
      setOpenRooms((prev: string[]) =>
        prev.includes(uiTargetLabel) ? prev : [...prev, uiTargetLabel]
      );

      cancelMoveJob();
    } catch (err) {
      console.error("[PropertyPage] unexpected move image error:", err);
      alert("Unexpected error moving image.");
    } finally {
      setMoveSaving(false);
    }
  };

  // ------------ OTHER HELPERS ------------

  const formatUpdatedLabel = (updated_at?: string) => {
    if (!updated_at) return "";
    const d = new Date(updated_at);
    return d.toLocaleString();
  };

  const formatCreatedLabel = (created_at?: string) => {
    if (!created_at) return "";
    const d = new Date(created_at);
    return d.toLocaleString();
  };

  const getStyleLabel = (styleId: string | null) => {
    if (!styleId) return "";
    const meta = ROOM_STYLES.find((s) => s.id === styleId);
    // @ts-ignore ROOM_STYLES may use `name` or `label` depending on your component
    return meta?.name ?? meta?.label ?? styleId;
  };

  const displayTitle =
    property?.title || property?.address_line_1 || "Untitled property";

  const displayAddress = property
    ? [
        property.address_line_1,
        property.city,
        property.state_province,
        property.postal_code,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  const handleMainImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !property || !user) return;

    setUploadingMainImage(true);
    setErrorMessage(null);

    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${property.id}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("property-images")
        .upload(path, file, {
          upsert: true,
        });

      if (uploadError) {
        console.error("[PropertyPage] main image upload error:", uploadError);
        setErrorMessage(uploadError.message);
        return;
      }

      const { data } = supabase.storage
        .from("property-images")
        .getPublicUrl(path);

      const publicUrl = data.publicUrl;

      const { error: updateError } = await supabase
        .from("properties")
        .update({ main_image_url: publicUrl })
        .eq("id", property.id);

      if (updateError) {
        console.error(
          "[PropertyPage] update main_image_url error:",
          updateError
        );
        setErrorMessage(updateError.message);
        return;
      }

      // update local state so UI refreshes immediately
      setProperty((prev: Property | null) =>
        prev ? { ...prev, main_image_url: publicUrl } : prev
      );
    } catch (err: any) {
      console.error("[PropertyPage] unexpected main image upload error:", err);
      setErrorMessage(
        err?.message ?? "Unexpected error while uploading property photo."
      );
    } finally {
      setUploadingMainImage(false);
      if (e.target) e.target.value = "";
    }
  };

  // ---------- primary image handler ----------

  const handleSetPrimaryForRoom = async (job: Job) => {
    if (!propertyId) return;

    try {
      setJobActionLoading(true);

      const rawRoomName = job.room_name?.trim() || null;

      // 1) Clear existing primaries for this property's room
      let clearQuery = supabase
        .from("jobs")
        .update({ is_primary_for_room: false })
        .eq("property_id", propertyId);

      if (rawRoomName === null) {
        clearQuery = clearQuery.is("room_name", null);
      } else {
        clearQuery = clearQuery.eq("room_name", rawRoomName);
      }

      const { error: clearError } = await clearQuery;
      if (clearError) {
        console.error("[PropertyPage] clear primary error:", clearError);
        alert("Failed to clear previous default image for this room.");
        return;
      }

      // 2) Mark this job as primary
      const { error: setError } = await supabase
        .from("jobs")
        .update({ is_primary_for_room: true })
        .eq("id", job.id);

      if (setError) {
        console.error("[PropertyPage] set primary error:", setError);
        alert("Failed to set this image as the room default.");
        return;
      }

      // 3) Update local state
      const targetKey = job.room_name?.trim() || "Unlabeled room";

      setJobs((prev: Job[]) =>
        prev.map((j) => {
          const key = j.room_name?.trim() || "Unlabeled room";
          if (key !== targetKey) return j;
          return { ...j, is_primary_for_room: j.id === job.id };
        })
      );
    } catch (err) {
      console.error("[PropertyPage] unexpected primary set error:", err);
      alert("Unexpected error setting default image.");
    } finally {
      setJobActionLoading(false);
    }
  };

  // ---------- modal + download/delete helpers ----------

  const openJobModal = (job: Job) => {
    const roomKey = job.room_name?.trim() || "Unlabeled room";

    // All staged jobs for this room, oldest → newest (same as grid)
    const roomJobs = jobs
      .filter(
        (j) =>
          (j.room_name?.trim() || "Unlabeled room") === roomKey &&
          j.staged_image_url
      )
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() -
          new Date(b.created_at).getTime()
      );

    const idx = roomJobs.findIndex((j) => j.id === job.id);

    setModalRoomJobs(roomJobs);
    setModalIndex(idx >= 0 ? idx : 0);
    setActiveJob(job);
    setModalOpen(true);
  };

  const closeJobModal = () => {
    if (jobActionLoading) return;
    setModalOpen(false);
    setActiveJob(null);
    setModalRoomJobs([]);
    setModalIndex(0);
  };

  const handleDownloadJob = async (url: string | null) => {
    if (!url) return;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error(
          "[PropertyPage] download fetch error:",
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
      console.error("[PropertyPage] unexpected download error:", err);
      alert("Unexpected error while downloading image.");
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    if (!jobId) return;
    const confirmed = window.confirm(
      "Delete this generated image from this property? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      setJobActionLoading(true);
      const { error } = await supabase.from("jobs").delete().eq("id", jobId);

      if (error) {
        console.error("[PropertyPage] delete job error:", error);
        alert("Failed to delete image. Check console for details.");
        return;
      }

      // Remove from local state so UI updates immediately
      setJobs((prev: Job[]) => prev.filter((job) => job.id !== jobId));

      // If we were viewing this job in the modal, close it
      if (activeJob && activeJob.id === jobId) {
        setActiveJob(null);
        setModalOpen(false);
        setModalRoomJobs([]);
        setModalIndex(0);
      }
    } catch (err) {
      console.error("[PropertyPage] unexpected delete job error:", err);
      alert("Unexpected error deleting image.");
    } finally {
      setJobActionLoading(false);
    }
  };

  // ---------- delete entire room (all images) ----------

  const handleDeleteRoom = async (roomLabel: string) => {
    if (!propertyId) return;

    const confirmed = window.confirm(
      "All images in this room will be deleted. This action cannot be undone. Continue?"
    );
    if (!confirmed) return;

    // Map UI label -> DB room_name
    const roomDbValue = roomLabel === "Unlabeled room" ? null : roomLabel;

    try {
      setJobActionLoading(true);

      // Delete all jobs for this property + room
      let deleteQuery = supabase
        .from("jobs")
        .delete()
        .eq("property_id", propertyId);

      if (roomDbValue === null) {
        deleteQuery = deleteQuery.is("room_name", null);
      } else {
        deleteQuery = deleteQuery.eq("room_name", roomDbValue);
      }

      const { error } = await deleteQuery;
      if (error) {
        console.error("[PropertyPage] delete room error:", error);
        alert("Failed to delete this room. Check console for details.");
        return;
      }

      // Remove all jobs for this room from local state
      setJobs((prev: Job[]) =>
        prev.filter((job) => {
          const key = job.room_name?.trim() || "Unlabeled room";
          return key !== roomLabel;
        })
      );

      // Close the accordion for this room
      setOpenRooms((prev: string[]) =>
        prev.filter((name) => name !== roomLabel)
      );

      // If modal is open for a job in this room, close it
      if (activeJob) {
        const activeKey = activeJob.room_name?.trim() || "Unlabeled room";
        if (activeKey === roomLabel) {
          setActiveJob(null);
          setModalOpen(false);
          setModalRoomJobs([]);
          setModalIndex(0);
        }
      }
    } catch (err) {
      console.error("[PropertyPage] unexpected delete room error:", err);
      alert("Unexpected error deleting room.");
    } finally {
      setJobActionLoading(false);
    }
  };

  // ---------- delete property ----------

  const handleDeleteProperty = async () => {
    if (!property || !propertyId) return;

    const confirmed = window.confirm(
      "Delete this property and all its staged images? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      setPropertyDeleting(true);

      // 1) Delete all jobs for this property
      const { error: jobsError } = await supabase
        .from("jobs")
        .delete()
        .eq("property_id", propertyId);

      if (jobsError) {
        console.error("[PropertyPage] delete jobs error:", jobsError);
        alert("Failed to delete staged images for this property. Check console.");
        return;
      }

      // 2) Delete the property itself
      const { error: propError } = await supabase
        .from("properties")
        .delete()
        .eq("id", propertyId);

      if (propError) {
        console.error("[PropertyPage] delete property error:", propError);
        alert("Failed to delete property. Check console for details.");
        return;
      }

      // 3) Redirect back to dashboard
      router.push("/app");
    } catch (err) {
      console.error("[PropertyPage] unexpected property delete error:", err);
      alert("Unexpected error deleting property.");
    } finally {
      setPropertyDeleting(false);
    }
  };

  // ---------- edit property helpers ----------

  const openEditPropertyModal = () => {
    if (!property) return;
    setPropertyForm({
      title: property.title ?? "",
      address_line_1: property.address_line_1 ?? "",
      city: property.city ?? "",
      state_province: property.state_province ?? "",
      postal_code: property.postal_code ?? "",
      mls_number: property.mls_number ?? "",
      notes: property.notes ?? "",
    });
    setEditingProperty(true);
  };

  const handleSaveProperty = async () => {
    if (!property) return;

    const payload = {
      title: propertyForm.title.trim() || null,
      address_line_1: propertyForm.address_line_1.trim() || null,
      city: propertyForm.city.trim() || null,
      state_province: propertyForm.state_province.trim() || null,
      postal_code: propertyForm.postal_code.trim() || null,
      mls_number: propertyForm.mls_number.trim() || null,
      notes: propertyForm.notes.trim() || null,
    };

    try {
      setPropertySaving(true);

      const { data, error } = await supabase
        .from("properties")
        .update(payload)
        .eq("id", property.id)
        .select(
          "id, title, address_line_1, city, state_province, postal_code, mls_number, notes, updated_at, main_image_url"
        )
        .maybeSingle();

      if (error) {
        console.error("[PropertyPage] update property error:", error);
        alert("Failed to save property changes. Check console for details.");
        return;
      }

      if (data) {
        setProperty(data as Property);
      }

      setEditingProperty(false);
    } catch (err) {
      console.error("[PropertyPage] unexpected update property error:", err);
      alert("Unexpected error saving property.");
    } finally {
      setPropertySaving(false);
    }
  };

  // ---------- full-view modal navigation helpers ----------

  const currentJob = modalRoomJobs[modalIndex] || activeJob;
  const canGoPrev =
    modalRoomJobs.length > 1 && modalIndex > 0;
  const canGoNext =
    modalRoomJobs.length > 1 && modalIndex < modalRoomJobs.length - 1;

  const goPrev = () => {
    if (!canGoPrev) return;
    setModalIndex((prev) => {
      const nextIndex = prev - 1;
      const nextJob = modalRoomJobs[nextIndex];
      if (nextJob) setActiveJob(nextJob);
      return nextIndex;
    });
  };

  const goNext = () => {
    if (!canGoNext) return;
    setModalIndex((prev) => {
      const nextIndex = prev + 1;
      const nextJob = modalRoomJobs[nextIndex];
      if (nextJob) setActiveJob(nextJob);
      return nextIndex;
    });
  };

  // Keyboard shortcuts: Esc to close, ← / → to navigate
  useEffect(() => {
    if (!modalOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (jobActionLoading) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closeJobModal();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [modalOpen, jobActionLoading, modalRoomJobs, modalIndex]);

  // ------------ RENDER ------------

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        {/* Top bar */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div className="flex items-start gap-3">
            {/* Property main image */}
            {property?.main_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={property.main_image_url}
                alt={`${displayTitle} main`}
                className="w-32 h-24 md:w-40 md:h-28 rounded-xl object-cover border border-slate-800 bg-black"
              />
            ) : (
              <div className="w-32 h-24 md:w-40 md:h-28 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-[11px] text-slate-500 bg-slate-950/60">
                No main photo
              </div>
            )}

            <div>
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
                {displayTitle}
              </h1>
              {displayAddress && (
                <p className="text-xs text-slate-400">{displayAddress}</p>
              )}
              {property?.mls_number && (
                <p className="text-[11px] text-slate-500 mt-1">
                  MLS {property.mls_number}
                </p>
              )}

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-60"
                  disabled={uploadingMainImage}
                >
                  {uploadingMainImage ? "Uploading…" : "Upload property photo"}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Link
                href="/app"
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition"
              >
                ← Back to dashboard
              </Link>
              <button
                type="button"
                onClick={openEditPropertyModal}
                disabled={!property}
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
              >
                Edit property
              </button>
              <button
                type="button"
                onClick={handleDeleteProperty}
                disabled={propertyDeleting}
                className="text-[11px] rounded-lg border border-red-700/70 px-3 py-1 text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
              >
                {propertyDeleting ? "Deleting property…" : "Delete property"}
              </button>
            </div>

            {property?.updated_at && (
              <span className="text-[10px] text-slate-500">
                Last updated {formatUpdatedLabel(property.updated_at)}
              </span>
            )}
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleMainImageUpload}
          />

          {/* Hidden bulk originals input */}
          <input
            ref={bulkFileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleBulkOriginalsSelected}
          />
        </div>

        {loading ? (
          <div className="text-xs text-slate-400 py-6">
            Loading property and staged rooms…
          </div>
        ) : errorMessage ? (
          <div className="text-xs text-rose-300 py-6">{errorMessage}</div>
        ) : !property ? (
          <div className="text-xs text-slate-400 py-6">
            Property not found.
          </div>
        ) : (
          <>
            {/* Notes (optional) */}
            {property.notes && (
              <section className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs">
                <h2 className="text-[11px] font-semibold text-slate-200 mb-1">
                  Agent notes
                </h2>
                <p className="text-[11px] text-slate-300 whitespace-pre-line">
                  {property.notes}
                </p>
              </section>
            )}

            {/* Rooms & staged photos */}
            <section className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">
                    Rooms & staged photos
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    {jobs.length === 0
                      ? "No staged rooms yet for this property."
                      : `${jobs.length} job${
                          jobs.length === 1 ? "" : "s"
                        } total`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                  <span>Sort rooms:</span>
                  <button
                    type="button"
                    onClick={() => setRoomSort("alpha")}
                    className={
                      "px-2 py-0.5 rounded-full border text-[10px] transition " +
                      (roomSort === "alpha"
                        ? "border-emerald-400/80 text-emerald-200 bg-emerald-500/10"
                        : "border-slate-700 hover:border-slate-500")
                    }
                  >
                    A–Z
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoomSort("recent")}
                    className={
                      "px-2 py-0.5 rounded-full border text-[10px] transition " +
                      (roomSort === "recent"
                        ? "border-emerald-400/80 text-emerald-200 bg-emerald-500/10"
                        : "border-slate-700 hover:border-slate-500")
                    }
                  >
                    Most recent
                  </button>

                  {/* Divider */}
                  <span className="mx-1 h-4 w-px bg-slate-700 hidden sm:inline-block" />

                  <span>Rooms:</span>
                  <button
                    type="button"
                    onClick={handleExpandAllRooms}
                    className="px-2 py-0.5 rounded-full border border-slate-700 text-[10px] hover:border-emerald-400/70 hover:text-emerald-200 transition"
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={handleCollapseAllRooms}
                    className="px-2 py-0.5 rounded-full border border-slate-700 text-[10px] hover:border-slate-500 hover:text-slate-100 transition"
                  >
                    Collapse all
                  </button>

                  {/* New room */}
                  <button
                    type="button"
                    onClick={handleCreateBlankRoom}
                    className="ml-1 px-2 py-0.5 rounded-full border border-emerald-500/70 text-[10px] text-emerald-200 bg-emerald-500/5 hover:bg-emerald-500/15 hover:border-emerald-400 transition"
                  >
                    + New room
                  </button>

                  {/* Bulk upload originals */}
                  <button
                    type="button"
                    onClick={handleOpenBulkUpload}
                    disabled={bulkUploading}
                    className="px-2 py-0.5 rounded-full border border-emerald-500/70 text-[10px] text-emerald-200 bg-emerald-500/5 hover:bg-emerald-500/15 hover:border-emerald-400 transition disabled:opacity-50"
                  >
                    {bulkUploading ? "Uploading photos…" : "Bulk upload photos"}
                  </button>
                </div>
              </div>

              {jobs.length === 0 ? (
                <div className="text-xs text-slate-500 py-4">
                  Generate a staged room from the main dashboard and select this
                  property to see it appear here.
                </div>
              ) : (
                sortedRooms.map(
                  ({
                    roomName: roomLabel,
                    jobs: roomJobs,
                    primaryImageUrl,
                    roomNotes,
                    imageCount,
                  }) => {
                    const isOpen = openRooms.includes(roomLabel);

                    // User-chosen primary for this room (if any)
                    const primaryJobForRoom = roomJobs.find(
                      (job) => job.is_primary_for_room
                    );

                    // Find earliest job in this room that has an original image
                    const originalJob =
                      roomJobs
                        .filter(
                          (job) =>
                            job.original_image_url &&
                            !job.original_image_url.startsWith("blob:")
                        )
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.created_at).getTime() -
                            new Date(b.created_at).getTime()
                        )[0] || null;

                    const originalUrl = originalJob?.original_image_url ?? null;

                    // Only jobs with staged images
                    const stagedJobs = roomJobs
                      .filter((j) => j.staged_image_url)
                      .slice()
                      .sort(
                        (a, b) =>
                          new Date(a.created_at).getTime() -
                          new Date(b.created_at).getTime()
                      );

                    // HERO selection logic for expanded view:
                    // 1) If primary has staged → HERO = that staged image
                    // 2) Else if staged jobs exist → HERO = latest staged
                    // 3) Else if original exists → HERO = original
                    // 4) Else → EMPTY
                    let heroJob: Job | null = null;
                    let heroUrl: string | null = null;

                    if (
                      primaryJobForRoom &&
                      primaryJobForRoom.staged_image_url
                    ) {
                      heroJob = primaryJobForRoom;
                      heroUrl =
                        primaryJobForRoom.staged_image_url ||
                        primaryJobForRoom.original_image_url ||
                        null;
                    } else if (stagedJobs.length > 0) {
                      const latestStaged =
                        stagedJobs[stagedJobs.length - 1];
                      heroJob = latestStaged;
                      heroUrl = latestStaged.staged_image_url || null;
                    } else if (originalUrl) {
                      heroJob = originalJob ?? null;
                      heroUrl = originalUrl;
                    }

                    const heroStyleLabel = heroJob?.style_id
                      ? getStyleLabel(heroJob.style_id)
                      : "";
                    const heroCreatedLabel = heroJob?.created_at
                      ? formatCreatedLabel(heroJob.created_at)
                      : "";

                    const heroIsOriginal =
                      !!heroUrl &&
                      !!originalUrl &&
                      heroUrl === originalUrl;

                    const encodedRoomLabel = encodeURIComponent(roomLabel);
                    const propertyQueryId = property?.id ?? "";

                    return (
                      <div
                        key={roomLabel}
                        className="mt-1 rounded-2xl border border-slate-800 bg-slate-950/60 overflow-hidden"
                      >
                        {/* Accordion header */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleRoomOpen(roomLabel)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleRoomOpen(roomLabel);
                            }
                          }}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-900/80 transition cursor-pointer"
                        >
                          {/* Left: thumbnail + room info + rename */}
                          <div className="flex items-center gap-3 min-w-0">
                            {primaryImageUrl && (
                              <div className="w-54 h-36 rounded-lg overflow-hidden border border-slate-700 bg-black flex-shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={primaryImageUrl}
                                  alt={`${roomLabel} thumbnail`}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}

                            <div className="flex flex-col min-w-0">
                              <span className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                                Room
                              </span>

                              {editingRoom === roomLabel ? (
                                <div className="flex items-center gap-2 mt-0.5">
                                  <input
                                    type="text"
                                    value={editingRoomValue}
                                    onChange={(e) =>
                                      setEditingRoomValue(e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      // prevent SPACE/keys from toggling accordion
                                      e.stopPropagation();

                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        saveRenameRoom(roomLabel);
                                      }

                                      if (e.key === "Escape") {
                                        e.preventDefault();
                                        cancelRenameRoom();
                                      }
                                    }}
                                    className="flex-1 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100 outline-none focus:border-emerald-400"
                                    placeholder="Room name (e.g., Living Room)"
                                    disabled={roomRenameLoading}
                                    autoFocus
                                  />

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      saveRenameRoom(roomLabel);
                                    }}
                                    disabled={roomRenameLoading}
                                    className="text-[10px] rounded-md border border-emerald-500/70 px-2 py-0.5 text-emerald-300 bg-emerald-500/10 hover:border-emerald-400/90 hover:text-emerald-100 transition disabled:opacity-50"
                                  >
                                    Save
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelRenameRoom();
                                    }}
                                    disabled={roomRenameLoading}
                                    className="text-[10px] rounded-md border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="text-sm text-slate-100 truncate">
                                    {roomLabel}{" "}
                                    <span className="text-[10px] text-slate-500">
                                      • {imageCount} image
                                      {imageCount === 1 ? "" : "s"}
                                    </span>
                                  </span>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      startRenameRoom(roomLabel);
                                    }}
                                    className="text-[10px] rounded-md border border-slate-700 px-2 py-0.5 text-slate-300 hover:border-emerald-400/70 hover:text-emerald-200 transition"
                                  >
                                    Rename
                                  </button>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteRoom(roomLabel);
                                    }}
                                    className="text-[10px] rounded-md border border-red-700/70 px-2 py-0.5 text-red-300 hover:bg-red-900/40 transition"
                                  >
                                    Delete room
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: chevron */}
                          <span className="ml-3 text-xs text-slate-400 flex-shrink-0">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </div>

                        {/* Accordion body */}
                        {isOpen && (
                          <div className="border-t border-slate-800 px-4 pb-3 pt-3 space-y-3 bg-slate-900/70">
                            {/* HERO image */}
                            <div>
                              {heroUrl ? (
                                <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden flex flex-col md:flex-row gap-0 mb-2">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={heroUrl}
                                    alt={roomLabel}
                                    className="w-full md:w-2/3 max-h-[360px] object-contain bg-black cursor-pointer"
                                    onClick={() => {
                                      // Only open modal if hero is a staged image with staged_image_url
                                      if (
                                        heroJob &&
                                        heroJob.staged_image_url
                                      ) {
                                        openJobModal(heroJob);
                                      }
                                    }}
                                  />
                                  <div className="flex-1 px-3 py-3 flex flex-col justify-between text-[11px]">
                                    <div>
                                      <div className="uppercase tracking-[0.18em] text-slate-500 mb-1">
                                        Room hero
                                      </div>
                                      <div className="text-xs text-slate-100">
                                        {roomLabel}
                                      </div>
                                      {heroStyleLabel && !heroIsOriginal && (
                                        <div className="mt-1 text-[11px] text-slate-300">
                                          Style: {heroStyleLabel}
                                        </div>
                                      )}
                                      {heroCreatedLabel && !heroIsOriginal && (
                                        <div className="text-[10px] text-slate-500">
                                          Generated {heroCreatedLabel}
                                        </div>
                                      )}
                                      {heroIsOriginal && (
                                        <div className="mt-2 text-[10px] text-slate-500">
                                          Showing the original photo as the
                                          hero image (no staged versions yet).
                                        </div>
                                      )}
                                      {!heroIsOriginal &&
                                        primaryJobForRoom &&
                                        heroJob &&
                                        primaryJobForRoom.id === heroJob.id && (
                                          <div className="mt-2 inline-flex items-center rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10">
                                            Default image for this room
                                          </div>
                                        )}
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 px-3 py-4 text-[11px] text-slate-500 mb-2">
                                  No images for this room yet. Generate a staged
                                  room from the main dashboard to see it appear
                                  here.
                                </div>
                              )}
                            </div>

                            {/* Room notes */}
                            <div className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px]">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="font-semibold text-slate-200">
                                  Room notes
                                </div>
                                {editingNotesRoom === roomLabel ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        saveRoomNotes(roomLabel);
                                      }}
                                      disabled={roomNotesLoading}
                                      className="rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10 hover:border-emerald-400/90 hover:text-emerald-100 transition disabled:opacity-50"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelEditRoomNotes();
                                      }}
                                      disabled={roomNotesLoading}
                                      className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1">
                                    {roomNotes &&
                                      roomNotes.trim().length > 0 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            clearRoomNotes(roomLabel);
                                          }}
                                          disabled={roomNotesLoading}
                                          className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-rose-500/80 hover:text-rose-200 transition disabled:opacity-50"
                                        >
                                          Clear
                                        </button>
                                      )}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        startEditRoomNotes(
                                          roomLabel,
                                          roomNotes
                                        );
                                      }}
                                      disabled={roomNotesLoading}
                                      className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                                    >
                                      {roomNotes &&
                                      roomNotes.trim().length > 0
                                        ? "Edit"
                                        : "Add"}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {editingNotesRoom === roomLabel ? (
                                <textarea
                                  value={editingNotesValue}
                                  onChange={(e) =>
                                    setEditingNotesValue(e.target.value)
                                  }
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400 min-h-[60px]"
                                  placeholder="Notes about this room (staging preferences, seller comments, MLS reminders)…"
                                  disabled={roomNotesLoading}
                                />
                              ) : roomNotes &&
                                roomNotes.trim().length > 0 ? (
                                <p className="text-slate-200 whitespace-pre-line">
                                  {roomNotes}
                                </p>
                              ) : (
                                <p className="text-slate-500 italic">
                                  No notes yet for this room. Use this area for
                                  MLS wording ideas, seller requests, or staging
                                  reminders.
                                </p>
                              )}
                            </div>

                            {/* Actions row: Generate in this room */}
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <p className="text-slate-400">
                                Continue generating for{" "}
                                <span className="text-slate-100 font-medium">
                                  {roomLabel}
                                </span>{" "}
                                with this property context.
                              </p>
                              <Link
                                href={`/app?propertyId=${propertyQueryId}&room=${encodedRoomLabel}#staging-area`}
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/80 px-3 py-1 text-[11px] text-emerald-200 bg-emerald-500/10 hover:border-emerald-400 hover:text-emerald-100 hover:bg-emerald-500/15 transition"
                              >
                                <span className="text-base leading-none">＋</span>
                                <span>Generate in this room</span>
                              </Link>
                            </div>

                            {/* Unified grid: Original + staged tiles */}
                            <div>
                              {(originalUrl || stagedJobs.length > 0) && (
                                <div className="text-[11px] text-slate-400 mb-1">
                                  Original &amp; staged versions
                                </div>
                              )}

                              {!originalUrl && stagedJobs.length === 0 ? (
                                <div className="text-[11px] text-slate-500 italic">
                                  No images for this room yet.
                                </div>
                              ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                  {/* Original tile (same size as others, pinned first) */}
                                  {originalJob && originalUrl && (
                                    <article className="group rounded-xl border border-emerald-600/70 bg-slate-950/80 overflow-hidden flex flex-col text-[10px]">
                                      <div className="relative">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={originalUrl}
                                          alt={`${roomLabel} original`}
                                          className="w-full h-28 object-cover bg-black"
                                        />
                                        <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                                      </div>

                                      <div className="px-2 py-2 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                          <div className="flex-1 min-w-0">
                                            <div className="text-[10px] font-semibold text-emerald-300">
                                              Before (original)
                                            </div>
                                            <div className="text-[10px] text-slate-500">
                                              Source photo
                                            </div>
                                          </div>

                                          <div className="flex flex-col items-end gap-1">
                                            <div>
                                              {primaryJobForRoom &&
                                              primaryJobForRoom.id ===
                                                originalJob.id ? (
                                                <span className="inline-flex items-center rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10">
                                                  Default
                                                </span>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleSetPrimaryForRoom(
                                                      originalJob
                                                    )
                                                  }
                                                  disabled={jobActionLoading}
                                                  className="inline-flex items-center rounded-md border border-slate-700 px-2 py-0.5 text-[10px] hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                                                >
                                                  Make default
                                                </button>
                                              )}
                                            </div>

                                            <div className="flex flex-col items-end gap-1">
                                              <Link
                                                href={`/app?propertyId=${propertyQueryId}&room=${encodedRoomLabel}&fromJobId=${originalJob.id}&fromOriginal=1#staging-area`}
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                                className="inline-flex items-center rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10 hover:border-emerald-400/90 hover:text-emerald-100 transition"
                                              >
                                                Continue from this image
                                              </Link>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDownloadJob(originalUrl);
                                                }}
                                                className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] hover:border-emerald-400/70 hover:text-emerald-200 transition"
                                              >
                                                Download
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </article>
                                  )}

                                  {/* Staged tiles */}
                                  {stagedJobs.map((job) => {
                                    const styleLabel = getStyleLabel(
                                      job.style_id
                                    );
                                    const createdLabel = formatCreatedLabel(
                                      job.created_at
                                    );
                                    const isPrimary =
                                      primaryJobForRoom &&
                                      primaryJobForRoom.id === job.id;
                                    return (
                                      <article
                                        key={job.id}
                                        onClick={() => openJobModal(job)}
                                        className="group rounded-xl border border-slate-800 bg-slate-950/80 overflow-hidden flex flex-col text-[10px] cursor-pointer 
                                                   transition transform hover:-translate-y-1 hover:shadow-[0_14px_30px_rgba(15,23,42,0.9)] hover:border-emerald-500/50"
                                      >
                                        <div className="relative">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={job.staged_image_url!}
                                            alt={`${roomLabel} staged`}
                                            className="w-full h-28 object-cover bg-black"
                                          />
                                          <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/10 transition" />
                                        </div>

                                        <div className="px-2 py-2 space-y-1">
                                          <div className="flex items-center justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                              {styleLabel && (
                                                <div className="text-[10px] text-slate-100 truncate">
                                                  {styleLabel}
                                                </div>
                                              )}
                                              <div className="text-[10px] text-slate-500 truncate">
                                                {createdLabel}
                                              </div>
                                            </div>

                                            <div className="flex flex-col items-end gap-1">
                                              <div>
                                                {isPrimary ? (
                                                  <span className="inline-flex items-center rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10">
                                                    Default
                                                  </span>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      handleSetPrimaryForRoom(
                                                        job
                                                      );
                                                    }}
                                                    disabled={jobActionLoading}
                                                    className="inline-flex items-center rounded-md border border-slate-700 px-2 py-0.5 text-[10px] hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                                                  >
                                                    Make default
                                                  </button>
                                                )}
                                              </div>

                                              <Link
                                                href={`/app?propertyId=${propertyQueryId}&room=${encodedRoomLabel}&fromJobId=${job.id}#staging-area`}
                                                onClick={(e) =>
                                                  e.stopPropagation()
                                                }
                                                className="inline-flex items-center rounded-md border border-emerald-500/70 px-2 py-0.5 text-[10px] text-emerald-300 bg-emerald-500/10 hover:border-emerald-400/90 hover:text-emerald-100 transition"
                                              >
                                                Continue from this image
                                              </Link>

                                              <div className="flex flex-wrap items-center gap-1">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDownloadJob(
                                                      job.staged_image_url
                                                    );
                                                  }}
                                                  className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] hover:border-emerald-400/70 hover:text-emerald-200 transition"
                                                >
                                                  Download
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    startMoveJob(job, roomLabel);
                                                  }}
                                                  className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] hover:border-sky-400/70 hover:text-sky-200 transition"
                                                >
                                                  Move
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteJob(job.id);
                                                  }}
                                                  disabled={jobActionLoading}
                                                  className="rounded-md border border-red-700/70 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
                                                >
                                                  Delete
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      </article>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  }
                )
              )}
            </section>
          </>
        )}
      </div>

      {/* FULL-VIEW MODAL */}
      {modalOpen && currentJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            className="absolute inset-0"
            onClick={jobActionLoading ? undefined : closeJobModal}
          />
          <div className="relative z-10 max-w-5xl w-full mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl flex flex-col overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Staged room
                </span>
                <span className="text-sm text-slate-100">
                  {currentJob.room_name || "Unlabeled room"}
                </span>
                {modalRoomJobs.length > 1 && (
                  <span className="text-[10px] text-slate-500">
                    Image {modalIndex + 1} of {modalRoomJobs.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadJob(currentJob.staged_image_url)
                  }
                  disabled={jobActionLoading}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteJob(currentJob.id)}
                  disabled={jobActionLoading}
                  className="text-[11px] rounded-lg border border-red-700/70 px-3 py-1 text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={closeJobModal}
                  disabled={jobActionLoading}
                  className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
                >
                  Close
                </button>
              </div>
            </div>

            {/* Modal body with arrows */}
            <div className="relative p-4 flex-1 flex items-center justify-center bg-slate-950">
              <div className="max-h-[80vh] w-full flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentJob.staged_image_url!}
                  alt={currentJob.style_id || "Staged room"}
                  className="max-h-[75vh] max-w-full object-contain rounded-xl border border-slate-800 bg-black"
                />
              </div>

              {/* Left arrow */}
              {canGoPrev && (
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={jobActionLoading}
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                >
                  ‹
                </button>
              )}

              {/* Right arrow */}
              {canGoNext && (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={jobActionLoading}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-2 text-slate-200 hover:border-emerald-400/70 hover:text-emerald-200 transition disabled:opacity-50"
                >
                  ›
                </button>
              )}
            </div>

            {/* Small footer info */}
            <div className="px-4 py-2 border-t border-slate-800 text-[10px] text-slate-500 flex items-center justify-between">
              <span>
                Job ID:{" "}
                <span className="text-slate-400">{currentJob.id}</span>
              </span>
              {currentJob.style_id && (
                <span>
                  Style:{" "}
                  <span className="uppercase tracking-[0.18em] text-slate-400">
                    {currentJob.style_id}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MOVE IMAGE TO ANOTHER ROOM MODAL */}
      {moveDialogOpen && moveJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            className="absolute inset-0"
            onClick={moveSaving ? undefined : cancelMoveJob}
          />
          <div className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl overflow-hidden text-[11px]">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Move image to another room
              </h2>
              <button
                type="button"
                onClick={cancelMoveJob}
                disabled={moveSaving}
                className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                  Current room
                </div>
                <div className="text-slate-100">
                  {moveJob.room_name?.trim() || "Unlabeled room"}
                </div>
              </div>

              {(() => {
                const currentLabel =
                  moveJob.room_name?.trim() || "Unlabeled room";
                const targetOptions = allRoomLabels.filter(
                  (label) => label !== currentLabel
                );
                return (
                  <>
                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                        Move to existing room
                      </label>
                      {targetOptions.length > 0 ? (
                        <select
                          value={moveExistingRoomLabel}
                          onChange={(e) =>
                            setMoveExistingRoomLabel(e.target.value)
                          }
                          className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                        >
                          <option value="">Select a room…</option>
                          {targetOptions.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="text-slate-500">
                          There are no other rooms yet. You can create a new
                          room name below.
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                        Or create a new room
                      </label>
                      <input
                        type="text"
                        value={moveNewRoomLabel}
                        onChange={(e) => setMoveNewRoomLabel(e.target.value)}
                        className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                        placeholder="New room name (e.g., Den, Kids Bedroom)"
                        disabled={moveSaving}
                      />
                      <p className="mt-1 text-[10px] text-slate-500">
                        If you enter a new room name, this image will start a
                        brand new room section for this property.
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelMoveJob}
                disabled={moveSaving}
                className="rounded-lg border border-slate-700 px-3 py-1 text-[11px] hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMoveJob}
                disabled={moveSaving}
                className="rounded-lg border border-sky-500/80 px-3 py-1 text-[11px] text-sky-200 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400 transition disabled:opacity-50"
              >
                {moveSaving ? "Moving…" : "Move image"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT PROPERTY MODAL */}
      {editingProperty && property && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div
            className="absolute inset-0"
            onClick={
              propertySaving ? undefined : () => setEditingProperty(false)
            }
          />
          <div className="relative z-10 w-full max-w-lg mx-4 rounded-2xl border border-slate-800 bg-slate-950/95 shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-tight">
                Edit property
              </h2>
              <button
                type="button"
                onClick={() => setEditingProperty(false)}
                disabled={propertySaving}
                className="text-[11px] rounded-lg border border-slate-700 px-2 py-1 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
              >
                Close
              </button>
            </div>

            <div className="px-4 py-3 space-y-3 text-[11px]">
              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    value={propertyForm.title}
                    onChange={(e) =>
                      setPropertyForm((prev) => ({
                        ...prev,
                        title: e.target.value,
                      }))
                    }
                    className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="Downtown condo, Family home, etc."
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                    Address line 1
                  </label>
                  <input
                    type="text"
                    value={propertyForm.address_line_1}
                    onChange={(e) =>
                      setPropertyForm((prev) => ({
                        ...prev,
                        address_line_1: e.target.value,
                      }))
                    }
                    className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    placeholder="123 Main St"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      value={propertyForm.city}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          city: e.target.value,
                        }))
                      }
                      className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                      State / Province
                    </label>
                    <input
                      type="text"
                      value={propertyForm.state_province}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          state_province: e.target.value,
                        }))
                      }
                      className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                      Postal code
                    </label>
                    <input
                      type="text"
                      value={propertyForm.postal_code}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          postal_code: e.target.value,
                        }))
                      }
                      className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                      MLS number
                    </label>
                    <input
                      type="text"
                      value={propertyForm.mls_number}
                      onChange={(e) =>
                        setPropertyForm((prev) => ({
                          ...prev,
                          mls_number: e.target.value,
                        }))
                      }
                      className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-[0.18em] text-slate-500 mb-1">
                    Agent notes
                  </label>
                  <textarea
                    value={propertyForm.notes}
                    onChange={(e) =>
                      setPropertyForm((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    rows={4}
                    className="w-full rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-emerald-400 resize-none"
                    placeholder="Private notes about this listing for your own reference."
                  />
                </div>
              </div>
            </div>

            <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProperty(false)}
                disabled={propertySaving}
                className="text-[11px] rounded-lg border border-slate-700 px-3 py-1 hover:border-slate-500 hover:text-slate-100 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProperty}
                disabled={propertySaving}
                className="text-[11px] rounded-lg border border-emerald-500/80 px-3 py-1 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-400 transition disabled:opacity-50"
              >
                {propertySaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
