import {
  METADATA_FETCH_PROFILES,
  PRODUCT_PAGE_FETCH_TIMEOUT_MS,
} from "@/lib/productUrlMetadata/constants";
import type { MetadataFetchAttemptRecord } from "@/lib/productUrlMetadata/types";

export type ProductPageFetchSuccess = {
  html: string;
  resolvedUrl: string;
  fetchProfile: string;
  contentType: string;
};

export type ProductPageFetchResult = {
  ok: boolean;
  blockedReason: string | null;
  attempts: MetadataFetchAttemptRecord[];
  success: ProductPageFetchSuccess | null;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function inferBlockedReason(attempts: MetadataFetchAttemptRecord[]): string | null {
  if (attempts.some((attempt) => attempt.status === 403)) return "http_403";
  if (attempts.some((attempt) => attempt.errorCode === "timeout")) return "timeout";
  if (attempts.some((attempt) => attempt.errorCode === "aborted")) return "aborted";
  if (attempts.some((attempt) => attempt.errorCode === "network_error")) return "network_error";
  if (attempts.some((attempt) => attempt.status !== null)) return "non_html_or_unreadable";
  return "fetch_failed";
}

export async function fetchProductPageHtml(
  fetchCandidates: string[],
  maxHtmlChars: number
): Promise<ProductPageFetchResult> {
  if (fetchCandidates.length === 0) {
    return {
      ok: false,
      blockedReason: "invalid_url",
      attempts: [],
      success: null,
    };
  }

  const attempts: MetadataFetchAttemptRecord[] = [];
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PRODUCT_PAGE_FETCH_TIMEOUT_MS);
  try {
    for (const fetchUrl of fetchCandidates) {
      for (const profile of METADATA_FETCH_PROFILES) {
        try {
          const response = await fetch(fetchUrl, {
            method: "GET",
            redirect: "follow",
            signal: controller.signal,
            headers: profile.headers,
            cache: "no-store",
          });
          const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
          const resolvedUrl = asOptionalString(response.url) ?? fetchUrl;
          attempts.push({
            inputUrl: fetchUrl,
            fetchProfile: profile.id,
            status: response.status,
            ok: response.ok,
            contentType,
            resolvedUrl,
            errorCode: null,
          });
          if (!response.ok || !contentType.includes("text/html")) {
            continue;
          }
          const html = (await response.text()).slice(0, maxHtmlChars);
          return {
            ok: true,
            blockedReason: null,
            attempts,
            success: {
              html,
              resolvedUrl,
              fetchProfile: profile.id,
              contentType,
            },
          };
        } catch (error: unknown) {
          const errorCode =
            error instanceof Error && error.name === "AbortError"
              ? timedOut
                ? "timeout"
                : "aborted"
              : "network_error";
          attempts.push({
            inputUrl: fetchUrl,
            fetchProfile: profile.id,
            status: null,
            ok: false,
            contentType: null,
            resolvedUrl: fetchUrl,
            errorCode,
          });
          if (errorCode === "aborted") {
            return {
              ok: false,
              blockedReason: "aborted",
              attempts,
              success: null,
            };
          }
          if (errorCode === "timeout") {
            return {
              ok: false,
              blockedReason: "timeout",
              attempts,
              success: null,
            };
          }
        }
      }
    }
    return {
      ok: false,
      blockedReason: inferBlockedReason(attempts),
      attempts,
      success: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
