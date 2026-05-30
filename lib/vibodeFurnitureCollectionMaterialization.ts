import type { SupabaseClient } from "@supabase/supabase-js";
import { detectSourceType, extractDomain } from "@/lib/attribution/parsers";
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";

type AnySupabaseClient = SupabaseClient;

type MaterializationErrorCode =
  | "folder_unavailable"
  | "folder_create_failed"
  | "folder_lookup_failed"
  | "item_lookup_failed"
  | "item_unavailable"
  | "collection_lookup_failed"
  | "collection_unavailable"
  | "partner_lookup_failed"
  | "partner_unavailable"
  | "import_lookup_failed"
  | "import_missing"
  | "materialize_failed";

export class FurnitureCollectionMaterializationError extends Error {
  code: MaterializationErrorCode;
  status: number;

  constructor(code: MaterializationErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export type MaterializableItem = {
  id: string;
  collection_id: string;
  product_name: string | null;
  product_url: string | null;
  image_url: string | null;
  brand: string | null;
  category: string | null;
  price_amount: number | string | null;
  price_currency: string | null;
};

export type MaterializableCollection = {
  id: string;
  partner_id: string;
  name: string;
  slug: string;
};

export type MaterializablePartner = {
  id: string;
  name: string;
  slug: string;
};

type EnsureFolderResult = {
  folder: {
    id: string;
    name: string;
    created_at?: string | null;
    updated_at?: string | null;
  };
  folderCreated: boolean;
};

type MaterializedItemResult = {
  alreadyExisted: boolean;
  userFurniture: {
    id: string;
    user_sku_id: string;
    display_name: string | null;
    preview_image_url: string | null;
    source_url: string | null;
    category: string | null;
    parsed_supplier_name: string | null;
    parsed_price_amount: number | null;
    parsed_price_currency: string | null;
    created_at: string;
    source_type: string | null;
    folder_id: string | null;
  };
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asHttpUrl(value: unknown): string | null {
  const raw = asOptionalString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function formatPriceText(currency: string | null, amount: number | null): string | null {
  if (amount === null || !Number.isFinite(amount)) return null;
  const normalizedCurrency = asOptionalString(currency)?.toUpperCase() ?? "CAD";
  return `${normalizedCurrency} ${amount.toFixed(2)}`;
}

function isMissingTableError(error: { message?: string | null; code?: string | null } | null): boolean {
  if (!error) return false;
  if (typeof error.code === "string" && error.code.toUpperCase() === "42P01") return true;
  return typeof error.message === "string" && /does not exist/i.test(error.message);
}

function isUniqueViolation(error: { code?: string | null } | null): boolean {
  return typeof error?.code === "string" && error.code === "23505";
}

export async function resolveMaterializableItemContext(
  supabaseAdmin: AnySupabaseClient,
  itemId: string
): Promise<{
  item: MaterializableItem;
  collection: MaterializableCollection;
  partner: MaterializablePartner;
}> {
  const { data: item, error: itemError } = await supabaseAdmin
    .from("vibode_furniture_collection_items")
    .select(
      "id,collection_id,product_name,product_url,image_url,brand,category,price_amount,price_currency,status,sort_order,created_at"
    )
    .eq("id", itemId)
    .eq("status", "active")
    .maybeSingle();
  if (itemError) {
    throw new FurnitureCollectionMaterializationError(
      "item_lookup_failed",
      500,
      "Failed to resolve Furniture Collection item."
    );
  }
  if (!item) {
    throw new FurnitureCollectionMaterializationError(
      "item_unavailable",
      404,
      "This collection item is no longer available."
    );
  }

  const { data: collection, error: collectionError } = await supabaseAdmin
    .from("vibode_furniture_collections")
    .select("id,partner_id,name,slug,status,visibility")
    .eq("id", item.collection_id)
    .eq("status", "active")
    .eq("visibility", "public")
    .maybeSingle();
  if (collectionError) {
    throw new FurnitureCollectionMaterializationError(
      "collection_lookup_failed",
      500,
      "Failed to resolve Furniture Collection."
    );
  }
  if (!collection) {
    throw new FurnitureCollectionMaterializationError(
      "collection_unavailable",
      404,
      "This collection item is no longer available."
    );
  }

  const { data: partner, error: partnerError } = await supabaseAdmin
    .from("vibode_furniture_partners")
    .select("id,name,slug,status")
    .eq("id", collection.partner_id)
    .eq("status", "active")
    .maybeSingle();
  if (partnerError) {
    throw new FurnitureCollectionMaterializationError(
      "partner_lookup_failed",
      500,
      "Failed to resolve Furniture Partner."
    );
  }
  if (!partner) {
    throw new FurnitureCollectionMaterializationError(
      "partner_unavailable",
      404,
      "This collection item is no longer available."
    );
  }

  return {
    item: item as MaterializableItem,
    collection: collection as MaterializableCollection,
    partner: partner as MaterializablePartner,
  };
}

export async function ensureCollectionImportAccess(args: {
  supabaseAdmin: AnySupabaseClient;
  userId: string;
  collectionId: string;
  sessionId?: string | null;
}) {
  const { data: importsForUser, error: importErrorForUser } = await args.supabaseAdmin
    .from("vibode_furniture_collection_imports")
    .select("id")
    .eq("user_id", args.userId)
    .eq("collection_id", args.collectionId)
    .limit(1);
  if (importErrorForUser) {
    throw new FurnitureCollectionMaterializationError(
      "import_lookup_failed",
      500,
      "Failed to verify Furniture Collection import access."
    );
  }

  const hasUserImport = Array.isArray(importsForUser) && importsForUser.length > 0;
  if (hasUserImport) return;

  if (args.sessionId) {
    const { data: importsForSession, error: importErrorForSession } = await args.supabaseAdmin
      .from("vibode_furniture_collection_imports")
      .select("id")
      .eq("session_id", args.sessionId)
      .eq("collection_id", args.collectionId)
      .limit(1);
    if (importErrorForSession) {
      throw new FurnitureCollectionMaterializationError(
        "import_lookup_failed",
        500,
        "Failed to verify Furniture Collection import access."
      );
    }
    if (Array.isArray(importsForSession) && importsForSession.length > 0) return;
  }

  throw new FurnitureCollectionMaterializationError(
    "import_missing",
    403,
    "Furniture Collection has not been added yet."
  );
}

export async function ensurePartnerMyFurnitureFolder(args: {
  userSupabase: AnySupabaseClient;
  userId: string;
  partnerName: string | null;
}): Promise<EnsureFolderResult> {
  const folderName = asOptionalString(args.partnerName) ?? "Furniture Partner";

  const { data: existingFolder, error: existingFolderError } = await args.userSupabase
    .from("vibode_user_furniture_folders")
    .select("id,name,created_at,updated_at")
    .eq("user_id", args.userId)
    .eq("name", folderName)
    .maybeSingle();

  if (existingFolderError) {
    if (isMissingTableError(existingFolderError)) {
      throw new FurnitureCollectionMaterializationError(
        "folder_unavailable",
        501,
        "Folders are not available yet for this environment."
      );
    }
    throw new FurnitureCollectionMaterializationError(
      "folder_lookup_failed",
      500,
      "Failed to resolve My Furniture folder."
    );
  }

  if (existingFolder) {
    return {
      folder: {
        id: existingFolder.id,
        name: existingFolder.name,
        created_at: existingFolder.created_at,
        updated_at: existingFolder.updated_at,
      },
      folderCreated: false,
    };
  }

  const { data: insertedFolder, error: insertFolderError } = await args.userSupabase
    .from("vibode_user_furniture_folders")
    .insert({ user_id: args.userId, name: folderName })
    .select("id,name,created_at,updated_at")
    .maybeSingle();

  if (insertFolderError) {
    if (isMissingTableError(insertFolderError)) {
      throw new FurnitureCollectionMaterializationError(
        "folder_unavailable",
        501,
        "Folders are not available yet for this environment."
      );
    }
    if (isUniqueViolation(insertFolderError)) {
      const { data: refetchedFolder, error: refetchFolderError } = await args.userSupabase
        .from("vibode_user_furniture_folders")
        .select("id,name,created_at,updated_at")
        .eq("user_id", args.userId)
        .eq("name", folderName)
        .maybeSingle();
      if (!refetchFolderError && refetchedFolder) {
        return {
          folder: {
            id: refetchedFolder.id,
            name: refetchedFolder.name,
            created_at: refetchedFolder.created_at,
            updated_at: refetchedFolder.updated_at,
          },
          folderCreated: false,
        };
      }
    }

    throw new FurnitureCollectionMaterializationError(
      "folder_create_failed",
      500,
      "Failed to create My Furniture folder."
    );
  }

  if (!insertedFolder) {
    throw new FurnitureCollectionMaterializationError(
      "folder_create_failed",
      500,
      "Failed to create My Furniture folder."
    );
  }

  return {
    folder: {
      id: insertedFolder.id,
      name: insertedFolder.name,
      created_at: insertedFolder.created_at,
      updated_at: insertedFolder.updated_at,
    },
    folderCreated: true,
  };
}

export async function materializeCollectionItemToMyFurniture(args: {
  userSupabase: AnySupabaseClient;
  userId: string;
  folderId: string;
  item: MaterializableItem;
  collection: MaterializableCollection;
  partner: MaterializablePartner;
}): Promise<MaterializedItemResult> {
  const displayName = asOptionalString(args.item.product_name) ?? "Furniture item";
  const previewImageUrl = asHttpUrl(args.item.image_url);
  if (!previewImageUrl) {
    throw new FurnitureCollectionMaterializationError(
      "item_unavailable",
      409,
      "This collection item is no longer available."
    );
  }
  const sourceUrl = asHttpUrl(args.item.product_url);
  const sourceDomain = extractDomain(sourceUrl);
  const priceAmount = asOptionalNumber(args.item.price_amount);
  const priceCurrency = asOptionalString(args.item.price_currency)?.toUpperCase() ?? "CAD";
  const category = asOptionalString(args.item.category);
  const supplierName = asOptionalString(args.item.brand) ?? asOptionalString(args.partner.name);
  const userSkuId = `furniture-collection-item:${args.item.id}`;

  const { data: existingRow, error: existingRowError } = await args.userSupabase
    .from("vibode_user_furniture")
    .select("id")
    .eq("user_id", args.userId)
    .eq("user_sku_id", userSkuId)
    .maybeSingle();
  if (existingRowError) {
    throw new FurnitureCollectionMaterializationError(
      "materialize_failed",
      500,
      "Failed to read existing My Furniture item."
    );
  }
  const alreadyExisted = Boolean(existingRow?.id);

  try {
    const saved = await upsertVibodeUserFurniture(args.userSupabase, {
      userId: args.userId,
      userSkuId,
      folderId: args.folderId,
      sourceType: "furniture_collection",
      displayName,
      previewImageUrl,
      sourceUrl,
      category,
      parsedDisplayName: displayName,
      parsedSourceUrl: sourceUrl,
      parsedSourceDomain: sourceDomain,
      parsedSupplierName: supplierName,
      parsedPriceText: formatPriceText(priceCurrency, priceAmount),
      parsedPriceAmount: priceAmount,
      parsedPriceCurrency: priceCurrency,
      parsedCategory: category,
      priceSourceType: detectSourceType(sourceDomain),
      priceConfidence: priceAmount !== null ? "high" : "none",
    });

    return {
      alreadyExisted,
      userFurniture: {
        id: saved.id,
        user_sku_id: saved.user_sku_id,
        display_name: saved.display_name,
        preview_image_url: saved.preview_image_url,
        source_url: saved.source_url,
        category: saved.category,
        parsed_supplier_name: saved.parsed_supplier_name,
        parsed_price_amount: saved.parsed_price_amount,
        parsed_price_currency: saved.parsed_price_currency,
        created_at: saved.created_at,
        source_type: saved.source_type,
        folder_id: saved.folder_id,
      },
    };
  } catch {
    throw new FurnitureCollectionMaterializationError(
      "materialize_failed",
      500,
      "Could not add this item yet. Please try again."
    );
  }
}
