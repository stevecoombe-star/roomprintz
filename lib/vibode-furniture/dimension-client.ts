import type { ModelDimensions, ModelSizingMode } from "@/lib/vibode-stage/model-dimensions";

export const PERSONAL_FURNITURE_DIMENSIONS_PATH = "/api/vibode/furniture-assets/dimensions";

export async function savePersonalFurnitureDimensions(input: Readonly<{
  assetId: string;
  token: string;
  widthM: number;
  heightM: number;
  depthM: number;
  sizingMode: ModelSizingMode;
  fetchImpl?: typeof fetch;
}>): Promise<
  | Readonly<{ ok: true; dimensions: ModelDimensions }>
  | Readonly<{ ok: false; message: string }>
> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(PERSONAL_FURNITURE_DIMENSIONS_PATH, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assetId: input.assetId,
        widthM: input.widthM,
        heightM: input.heightM,
        depthM: input.depthM,
        sizingMode: input.sizingMode,
      }),
    });
    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      error?: string;
      dimensions?: {
        widthM?: unknown;
        heightM?: unknown;
        depthM?: unknown;
        sizingMode?: unknown;
      };
    } | null;
    const dimensions = payload?.dimensions;
    if (
      !response.ok
      || !payload
      || payload.ok !== true
      || typeof dimensions?.widthM !== "number"
      || typeof dimensions.heightM !== "number"
      || typeof dimensions.depthM !== "number"
      || (dimensions.sizingMode !== "uniform" && dimensions.sizingMode !== "exact")
    ) {
      return {
        ok: false,
        message: payload?.error || "The model dimensions could not be saved.",
      };
    }
    return {
      ok: true,
      dimensions: {
        widthM: dimensions.widthM,
        heightM: dimensions.heightM,
        depthM: dimensions.depthM,
        sizingMode: dimensions.sizingMode,
      },
    };
  } catch {
    return { ok: false, message: "The model dimensions could not be saved. Check the connection and try again." };
  }
}
