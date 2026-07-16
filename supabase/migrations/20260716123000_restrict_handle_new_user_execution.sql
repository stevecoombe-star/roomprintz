-- Prevent the Auth user-creation trigger function from being called
-- directly through the public Supabase Data API.

begin;

revoke execute on function public.handle_new_user()
from public, anon, authenticated;

commit;
