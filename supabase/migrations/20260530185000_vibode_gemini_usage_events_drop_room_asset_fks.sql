-- Keep vibode_gemini_usage_events immutable: do not allow FK actions that
-- perform UPDATEs against append-only ledger rows when room content is deleted.
alter table public.vibode_gemini_usage_events
  drop constraint if exists vibode_gemini_usage_events_room_id_fkey,
  drop constraint if exists vibode_gemini_usage_events_asset_id_fkey,
  drop constraint if exists vibode_gemini_usage_events_version_id_fkey;
