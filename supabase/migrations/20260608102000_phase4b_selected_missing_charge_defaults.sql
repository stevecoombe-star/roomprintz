-- Phase 4B: default costs for selected newly charged flows.
-- Keeps previously migrated economics unchanged.

insert into public.vibode_token_operation_costs (operation_key, admin_label, model_version, token_cost, active, metadata)
values
  ('SCENE_REBUILD_USER_DIRECTED', 'Scene Rebuild: User Directed', null, 4, true, '{}'::jsonb),
  ('STAGE_LET_VIBODE_DECIDE', 'Stage: Let Vibode Decide', null, 5, true, '{}'::jsonb),
  ('INGEST_IMAGE', 'Ingest: Image', null, 1, true, '{}'::jsonb),
  ('INGEST_PRODUCT_URL', 'Ingest: Product URL', null, 1, true, '{}'::jsonb),
  ('FULL_VIBE', 'Full Vibe', null, 5, true, '{}'::jsonb)
on conflict (operation_key) do update
set
  admin_label = excluded.admin_label,
  token_cost = excluded.token_cost,
  active = excluded.active,
  updated_at = now();
