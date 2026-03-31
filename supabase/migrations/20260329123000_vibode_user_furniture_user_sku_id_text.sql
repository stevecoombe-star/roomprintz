alter table public.vibode_user_furniture
  alter column user_sku_id type text using user_sku_id::text;
