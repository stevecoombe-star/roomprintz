"use client";

import { useState } from "react";

type RemoteImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  placeholderLabel?: string;
};

export default function RemoteImage({
  src,
  alt,
  className,
  placeholderLabel = "No image available",
}: RemoteImageProps) {
  const normalizedSrc = typeof src === "string" ? src.trim() : "";
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasFailed = Boolean(normalizedSrc && failedSrc === normalizedSrc);

  if (!normalizedSrc || hasFailed) {
    return (
      <div
        aria-label={alt}
        className={
          className ??
          "flex items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-xs text-slate-400"
        }
      >
        {placeholderLabel}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={normalizedSrc}
      alt={alt}
      onError={() => setFailedSrc(normalizedSrc)}
      className={className ?? "rounded-lg bg-slate-900 object-cover"}
    />
  );
}
