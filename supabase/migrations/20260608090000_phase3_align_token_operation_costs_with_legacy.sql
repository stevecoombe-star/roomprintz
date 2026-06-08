-- Phase 3: align operation-based token costs with legacy charged route economics.
-- This keeps migrated charged routes at their existing token pricing.

insert into public.vibode_token_operation_costs (operation_key, admin_label, model_version, token_cost, active, metadata)
values
  ('SETUP_PREPARE_ROOM', 'Setup: Prepare Room', null, 2, true, '{}'::jsonb),
  ('SETUP_CLEANUP', 'Setup: Cleanup', null, 2, true, '{}'::jsonb),
  ('STAGE_PASTE_TO_PLACE', 'Stage: Paste To Place', null, 4, true, '{}'::jsonb),
  ('STYLE_RUN', 'Style: Run', null, 4, true, '{}'::jsonb),
  ('EDIT_REMOVE', 'Edit: Remove', null, 1, true, '{}'::jsonb),
  ('EDIT_SWAP', 'Edit: Swap', null, 2, true, '{}'::jsonb),
  ('EDIT_ROTATE', 'Edit: Rotate', null, 1, true, '{}'::jsonb)
on conflict (operation_key) do update
set
  admin_label = excluded.admin_label,
  token_cost = excluded.token_cost,
  active = excluded.active,
  updated_at = now();
