-- Keep vibode_token_charge_failures immutable: do not allow FK actions that
-- DELETE or UPDATE append-only ledger rows when parent rows are removed.
alter table public.vibode_token_charge_failures
  drop constraint if exists vibode_token_charge_failures_user_id_fkey,
  drop constraint if exists vibode_token_charge_failures_room_id_fkey,
  drop constraint if exists vibode_token_charge_failures_generation_run_id_fkey,
  drop constraint if exists vibode_token_charge_failures_output_asset_id_fkey;
