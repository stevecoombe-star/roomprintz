-- Keep vibode_gemini_usage_events immutable: do not allow FK actions that
-- perform UPDATEs against append-only ledger rows when an auth user is deleted.
alter table public.vibode_gemini_usage_events
  drop constraint if exists vibode_gemini_usage_events_user_id_fkey;
