-- One-time bootstrap ONLY, run by the Supabase project owner in SQL Editor.
-- Replace the UUID with the intended existing auth.users.id before execution.
-- Do NOT expose this SQL editor operation through any browser/API endpoint.
insert into private.user_roles(user_id, role)
values ('REPLACE_WITH_AUTH_USER_UUID'::uuid, 'admin')
on conflict (user_id, role) do nothing;
