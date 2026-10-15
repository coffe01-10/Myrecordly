-- OAuth refresh tokens are server-only. Desktop clients use the authenticated
-- google-drive function, never this table (including their own row).
create table public.google_drive_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_sub text not null,
  email text not null,
  refresh_token text not null,
  access_token text not null,
  expires_at bigint not null,
  folder_id text
);
alter table public.google_drive_connections enable row level security;
revoke all on public.google_drive_connections from public, anon, authenticated;
grant all on public.google_drive_connections to service_role;
