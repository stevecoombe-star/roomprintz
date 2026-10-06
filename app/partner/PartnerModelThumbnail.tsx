"use client";

import { useState } from "react";

import { modelThumbnailVisual } from "@/lib/vibode-stage/partner-model-library";

export function modelThumbnailIsFailed(
  url: string | null,
  failedUrl: string | null,
  imageFailed = false,
): boolean {
  if (imageFailed) return true;
  return url != null && url.length > 0 && failedUrl === url;
}

export function PartnerModelThumbnail(props: Readonly<{
  url: string | null;
  label: string;
  imageFailed?: boolean;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = modelThumbnailIsFailed(props.url, failedUrl, props.imageFailed === true);
  const visual = modelThumbnailVisual(props.url, failed);
  return (
    <div
      className="h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-stone-200"
      data-model-thumbnail={visual}
    >
      {visual === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- persisted catalog thumbnail, not a live GLB
        <img
          src={props.url ?? ""}
          alt=""
          className="h-full w-full object-contain"
          onError={() => {
            if (props.url) setFailedUrl(props.url);
          }}
        />
      ) : (
        <svg
          viewBox="0 0 64 64"
          className="h-full w-full p-3 text-slate-500"
          role="img"
          aria-label={`${props.label} preview`}
        >
          <g fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round">
            <path d="M32 16 L48 24 L32 32 L16 24 Z" />
            <path d="M16 24 L16 40 L32 48 L32 32" />
            <path d="M48 24 L48 40 L32 48" />
          </g>
        </svg>
      )}
    </div>
  );
}
