export const TOKEN_ACTION_KEYS = [
  "STAGE_1",
  "STAGE_2",
  "STAGE_3",
  "STAGE_4",
  "STAGE_5",
  "EDIT_REMOVE",
  "EDIT_SWAP",
  "EDIT_MOVE",
  "EDIT_ROTATE",
] as const;

export type TokenActionKey = (typeof TOKEN_ACTION_KEYS)[number];

export const TOKEN_DEFAULT_COSTS: Record<TokenActionKey, number> = {
  STAGE_1: 2,
  STAGE_2: 2,
  STAGE_3: 4,
  STAGE_4: 4,
  STAGE_5: 5,
  EDIT_REMOVE: 1,
  EDIT_SWAP: 2,
  EDIT_MOVE: 1,
  EDIT_ROTATE: 1,
};

export const TOKEN_BOOTSTRAP_STARTER_BALANCE = 40;
