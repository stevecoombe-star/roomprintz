-- MESHY-1A Gate A.1. Supabase default privileges granted service_role
-- every table privilege when these tables were created. Narrow that role
-- to select, insert, and update. The table owner retains the privileges
-- required for auth.users delete cascades.

BEGIN;

REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLE
  public.vibode_furniture_assets,
  public.vibode_furniture_asset_uploads
FROM service_role;

COMMIT;
