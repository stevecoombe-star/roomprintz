"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserAccessToken } from "@/lib/supabaseBrowser";
import {
  getMyFurnitureDisplayTitle,
  getMyFurniturePriceLabel,
  getMyFurniturePreferredImageUrl,
  getMyFurnitureSourceUrl,
  getMyFurnitureSubtitle,
  getMyFurnitureSupplier,
  getMyFurnitureUsageSignal,
  normalizeMyFurnitureItem,
  type MyFurnitureItem,
} from "@/lib/myFurniture";

type MyFurnitureDrawerProps = {
  item: MyFurnitureItem | null;
  onClose: () => void;
  onUseInRoom: (itemId: string) => void;
  isActing?: boolean;
};

type DrawerFormState = {
  displayName: string;
  supplier: string;
  priceText: string;
  sourceUrl: string;
  category: string;
};

type MyFurnitureUpdateResponse = {
  success?: boolean;
  item?: unknown;
  error?: string;
};

function buildFormState(item: MyFurnitureItem | null): DrawerFormState {
  if (!item) {
    return {
      displayName: "",
      supplier: "",
      priceText: "",
      sourceUrl: "",
      category: "",
    };
  }
  return {
    displayName: item.resolved.displayName ?? "",
    supplier: item.resolved.supplier ?? "",
    priceText: item.resolved.priceLabel ?? "",
    sourceUrl: item.resolved.sourceUrl ?? "",
    category: item.resolved.category ?? "",
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return "Unknown";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Unknown";
  return new Date(parsed).toLocaleString();
}

export function MyFurnitureDrawer({
  item,
  onClose,
  onUseInRoom,
  isActing = false,
}: MyFurnitureDrawerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [localItem, setLocalItem] = useState<MyFurnitureItem | null>(item);
  const [form, setForm] = useState<DrawerFormState>(() => buildFormState(item));

  useEffect(() => {
    setLocalItem(item);
    setForm(buildFormState(item));
    setIsEditing(false);
    setIsSaving(false);
    setSaveError(null);
  }, [item]);

  const effectiveItem = localItem ?? item;
  if (!effectiveItem) return null;

  const title = getMyFurnitureDisplayTitle(effectiveItem);
  const imageUrl = getMyFurniturePreferredImageUrl(effectiveItem);
  const supplier = getMyFurnitureSupplier(effectiveItem);
  const priceLabel = getMyFurniturePriceLabel(effectiveItem);
  const productUrl = getMyFurnitureSourceUrl(effectiveItem);
  const subtitle = getMyFurnitureSubtitle(effectiveItem);

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);

    try {
      const accessToken = await getSupabaseBrowserAccessToken();
      if (!accessToken) {
        throw new Error("Please sign in to edit saved furniture.");
      }

      const response = await fetch("/api/vibode/my-furniture/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          id: effectiveItem.id,
          overrideDisplayName: form.displayName || null,
          overrideSupplierName: form.supplier || null,
          overridePriceText: form.priceText || null,
          overridePriceAmount: null,
          overridePriceCurrency: null,
          overrideSourceUrl: form.sourceUrl || null,
          overrideCategory: form.category || null,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as MyFurnitureUpdateResponse;
      if (!response.ok) {
        throw new Error(payload.error || `Failed to update item (HTTP ${response.status}).`);
      }

      const normalized = normalizeMyFurnitureItem(payload.item ?? null);
      if (normalized) {
        setLocalItem(normalized);
        setForm(buildFormState(normalized));
      }

      setIsEditing(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Could not save your edits right now. Please try again.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setForm(buildFormState(effectiveItem));
    setIsEditing(false);
    setSaveError(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/70"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-slate-800 bg-slate-950 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <button
                type="button"
                disabled={isActing || isSaving}
                onClick={() => setIsEditing(true)}
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
              >
                Edit details
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
          {imageUrl ? (
            <img src={imageUrl} alt={title} className="h-64 w-full object-cover" />
          ) : (
            <div className="flex h-64 items-center justify-center text-xs text-slate-500">No preview</div>
          )}
        </div>

        <dl className="mt-4 space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs">
          <div>
            <dt className="text-slate-500">Usage</dt>
            <dd className="mt-0.5 text-slate-200">{getMyFurnitureUsageSignal(effectiveItem)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Created</dt>
            <dd className="mt-0.5 text-slate-200">{formatDateTime(effectiveItem.createdAt)}</dd>
          </div>
          {!isEditing && supplier ? (
            <div>
              <dt className="text-slate-500">Supplier</dt>
              <dd className="mt-0.5 text-slate-200">{supplier}</dd>
            </div>
          ) : null}
          {!isEditing && priceLabel ? (
            <div>
              <dt className="text-slate-500">Price</dt>
              <dd className="mt-0.5 text-slate-200">{priceLabel}</dd>
            </div>
          ) : null}
          {!isEditing && productUrl ? (
            <div>
              <dt className="text-slate-500">View product</dt>
              <dd className="mt-0.5 break-all text-slate-300">
                <a
                  href={productUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-slate-500 underline-offset-2 hover:text-slate-100"
                >
                  {productUrl}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>

        {isEditing ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/50 p-3">
            <div className="grid gap-3">
              <input
                value={form.displayName}
                onChange={(event) => setForm({ ...form, displayName: event.target.value })}
                placeholder="Name"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
              />
              <input
                value={form.supplier}
                onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                placeholder="Supplier"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
              />
              <input
                value={form.priceText}
                onChange={(event) => setForm({ ...form, priceText: event.target.value })}
                placeholder="Price (e.g. $499)"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
              />
              <input
                value={form.sourceUrl}
                onChange={(event) => setForm({ ...form, sourceUrl: event.target.value })}
                placeholder="Product link"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
              />
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                placeholder="Category"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-slate-500"
              />
            </div>
            {saveError ? <p className="mt-2 text-xs text-rose-300">{saveError}</p> : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave()}
                className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleCancel}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={isActing || isSaving}
            onClick={() => onUseInRoom(effectiveItem.id)}
            className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-900 transition hover:bg-white disabled:opacity-50"
          >
            Use in Room
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Load this item into Paste-to-Place so you can place it in your room.
        </p>
      </aside>
    </div>
  );
}
