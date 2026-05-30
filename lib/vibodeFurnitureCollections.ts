type JsonObject = Record<string, unknown>;

export const VIBODE_FURNITURE_PARTNER_STATUSES = ["active", "inactive"] as const;
export type VibodeFurniturePartnerStatus = (typeof VIBODE_FURNITURE_PARTNER_STATUSES)[number];

export const VIBODE_FURNITURE_COLLECTION_VISIBILITIES = ["public", "private", "unlisted"] as const;
export type VibodeFurnitureCollectionVisibility =
  (typeof VIBODE_FURNITURE_COLLECTION_VISIBILITIES)[number];

export const VIBODE_FURNITURE_COLLECTION_STATUSES = ["active", "inactive", "archived"] as const;
export type VibodeFurnitureCollectionStatus = (typeof VIBODE_FURNITURE_COLLECTION_STATUSES)[number];

export const VIBODE_FURNITURE_COLLECTION_ITEM_STATUSES = ["active", "inactive"] as const;
export type VibodeFurnitureCollectionItemStatus =
  (typeof VIBODE_FURNITURE_COLLECTION_ITEM_STATUSES)[number];

// TODO(vibode-furniture-collections): use these prefixes when phase-2 routes are added.
export const VIBODE_FURNITURE_COLLECTION_PUBLIC_ROUTE_PREFIX = "/furniture-collections";
export const VIBODE_FURNITURE_COLLECTION_ADMIN_ROUTE_PREFIX = "/admin/furniture-collections";

export type VibodeFurniturePartnerRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  website_url: string | null;
  description: string | null;
  status: VibodeFurniturePartnerStatus;
  internal_notes: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type VibodeFurnitureCollectionRow = {
  id: string;
  partner_id: string;
  name: string;
  slug: string;
  description: string | null;
  hero_image_url: string | null;
  visibility: VibodeFurnitureCollectionVisibility;
  status: VibodeFurnitureCollectionStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type VibodeFurnitureCollectionItemRow = {
  id: string;
  collection_id: string;
  product_name: string;
  product_url: string | null;
  image_url: string | null;
  stored_asset_id: string | null;
  brand: string | null;
  category: string | null;
  price_amount: number | null;
  price_currency: string | null;
  sort_order: number;
  status: VibodeFurnitureCollectionItemStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type VibodeFurnitureCollectionImportRow = {
  id: string;
  user_id: string | null;
  session_id: string | null;
  collection_id: string;
  source: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type CreateVibodeFurniturePartnerInput = {
  name: string;
  slug: string;
  logo_url?: string | null;
  website_url?: string | null;
  description?: string | null;
  status?: VibodeFurniturePartnerStatus;
  internal_notes?: string | null;
  metadata?: JsonObject;
};

export type CreateVibodeFurnitureCollectionInput = {
  partner_id: string;
  name: string;
  slug: string;
  description?: string | null;
  hero_image_url?: string | null;
  visibility?: VibodeFurnitureCollectionVisibility;
  status?: VibodeFurnitureCollectionStatus;
  metadata?: JsonObject;
};

export type CreateVibodeFurnitureCollectionItemInput = {
  collection_id: string;
  product_name: string;
  product_url?: string | null;
  image_url?: string | null;
  stored_asset_id?: string | null;
  brand?: string | null;
  category?: string | null;
  price_amount?: number | null;
  price_currency?: string | null;
  sort_order?: number;
  status?: VibodeFurnitureCollectionItemStatus;
  metadata?: JsonObject;
};

export type CreateVibodeFurnitureCollectionImportInput = {
  user_id?: string | null;
  session_id?: string | null;
  collection_id: string;
  source?: string;
  metadata?: JsonObject;
};

export function isVibodeFurnitureCollectionPubliclyVisible(
  collection: Pick<VibodeFurnitureCollectionRow, "visibility" | "status">,
  partner: Pick<VibodeFurniturePartnerRow, "status">
): boolean {
  return (
    partner.status === "active" && collection.status === "active" && collection.visibility === "public"
  );
}

export function isVibodeFurnitureCollectionItemPubliclyVisible(
  item: Pick<VibodeFurnitureCollectionItemRow, "status">
): boolean {
  return item.status === "active";
}
