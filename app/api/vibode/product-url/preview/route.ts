import { NextRequest } from "next/server";
import { resolveProductUrlMetadata } from "@/lib/productUrlMetadata/resolver";
import { normalizeLikelyUrl } from "@/lib/productUrlMetadata/url";

export const runtime = "nodejs";

const PREVIEW_ROUTE = "/api/vibode/product-url/preview";

type ProductPageMetadata = {
  title: string | null;
  previewImageUrl: string | null;
  fetchOk: boolean;
  resolvedUrl: string | null;
  blockedReason: string | null;
};

function createRequestId(): string {
  try {
    return `vibode-preview-${crypto.randomUUID()}`;
  } catch {
    return `vibode-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function logPreviewEvent(
  level: "info" | "warn" | "error",
  event: string,
  requestId: string,
  fields: Record<string, unknown> = {}
): void {
  const payload: Record<string, unknown> = {
    event,
    request_id: requestId,
    route: PREVIEW_ROUTE,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  const message = `[vibode/product-url/preview] ${JSON.stringify(payload)}`;
  if (level === "warn") {
    console.warn(message);
    return;
  }
  if (level === "error") {
    console.error(message);
    return;
  }
  console.info(message);
}

async function fetchProductPageMetadata(sourceUrl: string, requestId: string): Promise<ProductPageMetadata> {
  const resolved = await resolveProductUrlMetadata({
    sourceUrl,
    includePrice: false,
    mode: "preview",
    requestId,
  });

  if (!resolved.normalizedSourceUrl) {
    logPreviewEvent("warn", "metadata_invalid_url", requestId, {
      source_url: sourceUrl,
    });
    return {
      title: null,
      previewImageUrl: null,
      fetchOk: false,
      resolvedUrl: null,
      blockedReason: resolved.blockedReason,
    };
  }

  const attemptCount = resolved.diagnostics.attempts.length;
  resolved.diagnostics.attempts.forEach((attempt, index) => {
    logPreviewEvent("info", "metadata_fetch_response", requestId, {
      fetch_attempt_index: index,
      fetch_attempt_count: attemptCount,
      fetch_profile: attempt.fetchProfile,
      fetch_input_url: attempt.inputUrl,
      fetch_status: attempt.status,
      fetch_ok: attempt.ok,
      fetch_content_type: attempt.contentType ?? "",
      fetch_resolved_url: attempt.resolvedUrl ?? attempt.inputUrl,
    });
  });

  if (!resolved.fetchOk) {
    if (resolved.diagnostics.attempts.some((attempt) => attempt.errorCode)) {
      logPreviewEvent("warn", "metadata_fetch_exception", requestId, {
        source_url: resolved.normalizedSourceUrl ?? sourceUrl,
        blocked_reason: resolved.blockedReason,
      });
    }
    return {
      title: null,
      previewImageUrl: null,
      fetchOk: false,
      resolvedUrl: null,
      blockedReason: resolved.blockedReason,
    };
  }

  const successfulAttempt =
    resolved.diagnostics.attempts.find(
      (attempt) => attempt.ok && (attempt.contentType ?? "").toLowerCase().includes("text/html")
    ) ?? null;
  logPreviewEvent("info", "metadata_fetch_extracted", requestId, {
    html_length: resolved.diagnostics.htmlLength,
    html_substantial: resolved.diagnostics.htmlSubstantial,
    has_title: Boolean(resolved.title),
    has_preview_image: Boolean(resolved.previewImageUrl),
    fetch_profile: successfulAttempt?.fetchProfile ?? null,
  });

  return {
    title: resolved.title,
    previewImageUrl: resolved.previewImageUrl,
    fetchOk: resolved.fetchOk,
    resolvedUrl: resolved.resolvedUrl,
    blockedReason: resolved.blockedReason,
  };
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const body = (await req.json().catch(() => null)) as { sourceUrl?: unknown } | null;
    const sourceUrlRaw = asOptionalString(body?.sourceUrl);
    if (!sourceUrlRaw) {
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }
    const normalizedUrl = normalizeLikelyUrl(sourceUrlRaw);
    if (!normalizedUrl) {
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }

    const metadata = await fetchProductPageMetadata(normalizedUrl, requestId);
    if (!metadata.fetchOk || !metadata.previewImageUrl) {
      logPreviewEvent("warn", "preview_unavailable", requestId, {
        normalized_url: normalizedUrl,
        metadata_fetch_ok: metadata.fetchOk,
        has_preview_image: Boolean(metadata.previewImageUrl),
        blocked_reason: metadata.blockedReason,
      });
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }

    const domain = (() => {
      try {
        return new URL(metadata.resolvedUrl ?? normalizedUrl).hostname || null;
      } catch {
        return null;
      }
    })();

    logPreviewEvent("info", "preview_ready", requestId, {
      normalized_url: normalizedUrl,
      resolved_url: metadata.resolvedUrl,
      domain,
      has_title: Boolean(metadata.title),
      has_preview_image: Boolean(metadata.previewImageUrl),
    });
    return Response.json({
      ok: true,
      normalizedUrl,
      title: metadata.title,
      previewImageUrl: metadata.previewImageUrl,
      domain,
      requestId,
    });
  } catch (err: unknown) {
    logPreviewEvent("error", "failed", requestId, {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      {
        ok: false,
        code: "product_url_blocked_or_unreadable",
        error: "We couldn't prepare that product link. Try copying the product image instead.",
        requestId,
      },
      { status: 422 }
    );
  }
}
