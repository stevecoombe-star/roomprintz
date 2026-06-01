// components/UploadCard.tsx
"use client";

import Image from "next/image";
import {
  ChangeEvent,
  DragEvent,
  useState,
} from "react";
import {
  isLivePhotoMovCompanion,
  isSupportedStillImageFile,
  SUPPORTED_STILL_IMAGE_ACCEPT_ATTR,
} from "@/lib/uploadImageFileTypes";

type UploadCardProps = {
  file: File | null;
  previewUrl: string | null;
  onFileChange: (file: File | null) => void;
};

export function UploadCard({ file, previewUrl, onFileChange }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const nextFile = e.target.files?.[0] ?? null;
    if (nextFile && isLivePhotoMovCompanion(nextFile)) {
      alert("Live Photo video detected. Vibode needs the still image, not the video clip.");
      onFileChange(null);
      e.target.value = "";
      return;
    }
    if (nextFile && !isSupportedStillImageFile(nextFile)) {
      alert("Please upload a JPG, PNG, WebP, or HEIC/HEIF still image.");
      onFileChange(null);
      e.target.value = "";
      return;
    }
    onFileChange(nextFile);
  };

  const handleClear = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation(); // don’t trigger click → file dialog
    onFileChange(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only reset if we actually left the drop zone, not moving between children
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files ?? []);
    if (droppedFiles.length === 0) return;

    const droppedStill = droppedFiles.find((file) => isSupportedStillImageFile(file));
    if (!droppedStill) {
      if (droppedFiles.every((file) => isLivePhotoMovCompanion(file))) {
        alert("Live Photo video detected. Vibode needs the still image, not the video clip.");
        return;
      }
      alert("Please drop a JPG, PNG, WebP, or HEIC/HEIF still image.");
      return;
    }

    onFileChange(droppedStill);
  };

  const borderClasses = isDragging
    ? "border-emerald-400 bg-emerald-500/5"
    : "border-slate-800 hover:border-emerald-400/70";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold">1. Upload Room Photo</h2>
        <p className="text-xs text-slate-400">
          Drag &amp; drop a room photo, or click to choose an image from your computer.
        </p>
      </div>

      {/* Hidden file input */}
      <input
        id="room-upload-input"
        type="file"
        accept={SUPPORTED_STILL_IMAGE_ACCEPT_ATTR}
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Drag & drop surface */}
      <div
        className={`relative rounded-xl border ${borderClasses} bg-slate-950/80 transition-colors cursor-pointer`}
        onClick={() => {
          const input = document.getElementById(
            "room-upload-input"
          ) as HTMLInputElement | null;
          input?.click();
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="p-4 flex flex-col gap-3">
          {!previewUrl ? (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-8">
              <div className="text-xs text-slate-300">
                Drag &amp; drop a room photo here
              </div>
              <div className="text-[11px] text-slate-500">
                or <span className="text-emerald-300">click to browse</span>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">
                JPG/PNG/WebP/HEIC supported · Live Photos use still image only
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Preview</span>
                <button
                  type="button"
                  onClick={handleClear}
                  className="text-[11px] text-slate-300 hover:text-rose-300"
                >
                  Clear
                </button>
              </div>
              <div className="relative w-full h-40 overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
                <Image
                  src={previewUrl}
                  alt="Uploaded room preview"
                  fill
                  className="object-cover"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Drag a new image here or click to replace.
              </p>
            </>
          )}

          {isDragging && (
            <div className="pointer-events-none absolute inset-0 rounded-xl border border-emerald-400/80 bg-emerald-500/10 flex items-center justify-center text-xs text-emerald-200">
              Drop image to upload
            </div>
          )}
        </div>
      </div>

      {/* Optional file name */}
      {file && (
        <p className="text-[10px] text-slate-500 truncate">
          Current file: <span className="text-slate-300">{file.name}</span>
        </p>
      )}
    </div>
  );
}
