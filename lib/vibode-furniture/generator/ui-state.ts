/**
 * Drawer UI state for photo slots and Meshy settings.
 * Preview object URLs are browser-local. Replacing or removing a photo
 * reports the previous URL so the caller can revoke it.
 */

import {
  emptyFurniturePhotoSet,
  furnitureInputMode,
  removeFurniturePhoto,
  replacePreviewUrl,
  setFurniturePhoto,
  type FurniturePhotoRecord,
  type FurniturePhotoSet,
  type FurnitureViewSlot,
} from "./images";
import {
  defaultFurnitureGeneratorSettings,
  reconcileGeneratorSettings,
  type FurnitureGeneratorSettings,
  type GeneratorCapabilityMode,
} from "./settings";

export type FurnitureGeneratorUiState = Readonly<{
  photos: FurniturePhotoSet;
  previewUrls: Readonly<Partial<Record<FurnitureViewSlot, string>>>;
  settings: FurnitureGeneratorSettings;
  notices: readonly string[];
  slotErrors: Readonly<Partial<Record<FurnitureViewSlot, string>>>;
}>;

export type FurnitureGeneratorAction =
  | Readonly<{ type: "set-photo"; photo: FurniturePhotoRecord; previewUrl: string }>
  | Readonly<{ type: "remove-photo"; slot: FurnitureViewSlot }>
  | Readonly<{ type: "slot-error"; slot: FurnitureViewSlot; message: string | null }>
  | Readonly<{ type: "settings"; settings: FurnitureGeneratorSettings }>;

export type FurnitureGeneratorReduction = Readonly<{
  state: FurnitureGeneratorUiState;
  revokeUrls: readonly string[];
}>;

export function initialFurnitureGeneratorUi(
  seed?: FurnitureGeneratorUiState,
): FurnitureGeneratorUiState {
  if (!seed) {
    return {
      photos: emptyFurniturePhotoSet(),
      previewUrls: {},
      settings: defaultFurnitureGeneratorSettings(),
      notices: [],
      slotErrors: {},
    };
  }
  const reconciled = reconcileGeneratorSettings(seed.settings, capabilityMode(seed.photos));
  return {
    photos: seed.photos,
    previewUrls: seed.previewUrls,
    settings: reconciled.settings,
    notices: reconciled.notices,
    slotErrors: seed.slotErrors,
  };
}

export function reduceFurnitureGenerator(
  state: FurnitureGeneratorUiState,
  action: FurnitureGeneratorAction,
): FurnitureGeneratorReduction {
  if (action.type === "slot-error") {
    const slotErrors = { ...state.slotErrors };
    if (action.message) slotErrors[action.slot] = action.message;
    else delete slotErrors[action.slot];
    return { state: { ...state, slotErrors }, revokeUrls: [] };
  }
  if (action.type === "remove-photo") {
    const replaced = replacePreviewUrl(state.previewUrls, action.slot, null);
    const slotErrors = { ...state.slotErrors };
    delete slotErrors[action.slot];
    const photos = removeFurniturePhoto(state.photos, action.slot);
    return {
      state: reconcileInto({ ...state, photos, previewUrls: replaced.urls, slotErrors }),
      revokeUrls: replaced.revoke,
    };
  }
  if (action.type === "set-photo") {
    const replaced = replacePreviewUrl(state.previewUrls, action.photo.slot, action.previewUrl);
    const slotErrors = { ...state.slotErrors };
    delete slotErrors[action.photo.slot];
    const photos = setFurniturePhoto(state.photos, action.photo);
    return {
      state: reconcileInto({ ...state, photos, previewUrls: replaced.urls, slotErrors }),
      revokeUrls: replaced.revoke,
    };
  }
  return {
    state: reconcileInto({ ...state, settings: action.settings }),
    revokeUrls: [],
  };
}

export function capabilityMode(photos: FurniturePhotoSet): GeneratorCapabilityMode {
  return furnitureInputMode(photos) === "multi" ? "multi" : "single";
}

function reconcileInto(state: FurnitureGeneratorUiState): FurnitureGeneratorUiState {
  const reconciled = reconcileGeneratorSettings(state.settings, capabilityMode(state.photos));
  return { ...state, settings: reconciled.settings, notices: reconciled.notices };
}
