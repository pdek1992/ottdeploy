-- Draft Supabase schema for the OTT Vercel migration.
-- Public tables hold non-secret application data.
-- Private tables hold server-only data and should be accessed through Vercel APIs.

create extension if not exists pgcrypto;
create extension if not exists citext;
create schema if not exists private;

create table if not exists public.access_users (
  id uuid primary key default gen_random_uuid(),
  email citext,
  legacy_user_id text,
  display_name text,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  subscription_tier text not null default 'basic' check (subscription_tier in ('basic', 'standard', 'premium')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  can_stream boolean not null default true,
  can_view_dashboard boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_users_identity_check check (
    email is not null or legacy_user_id is not null
  )
);

create unique index if not exists access_users_email_idx
  on public.access_users (email)
  where email is not null;

create unique index if not exists access_users_legacy_user_id_idx
  on public.access_users (legacy_user_id)
  where legacy_user_id is not null;

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_videos (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text not null default '',
  category text not null default 'Browse',
  genre text,
  language text,
  year_label text,
  duration_label text,
  maturity_rating text not null default 'U/A',
  thumbnail_url text,
  poster_url text,
  featured boolean not null default false,
  playable boolean not null default true,
  is_reference_stream boolean not null default false,
  ad_cue_points jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_streams (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.catalog_videos(id) on delete cascade,
  origin_type text not null check (origin_type in ('cdn', 'r2', 'external', 'local')),
  manifest_url text not null,
  thumbnail_url text,
  drm_scheme text not null default 'clearkey',
  is_primary boolean not null default true,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists video_streams_primary_idx
  on public.video_streams (video_id, is_primary)
  where is_primary = true;

create table if not exists public.catalog_rails (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalog_rail_items (
  id uuid primary key default gen_random_uuid(),
  rail_id uuid not null references public.catalog_rails(id) on delete cascade,
  video_id uuid not null references public.catalog_videos(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (rail_id, video_id)
);

create table if not exists private.video_keys (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.catalog_videos(id) on delete cascade,
  key_id_hex text not null,
  key_hex text not null,
  key_version integer not null default 1,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  unique (video_id, key_version)
);

create table if not exists public.user_credentials (
  id uuid primary key default gen_random_uuid(),
  access_user_id uuid not null unique references public.access_users(id) on delete cascade,
  password_hash text not null,
  password_algo text not null default 'argon2id',
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  password_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  access_user_id uuid not null references public.access_users(id) on delete cascade,
  session_token_hash text not null unique,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  ip_hash text,
  user_agent text
);

create index if not exists user_sessions_access_user_id_idx
  on public.user_sessions (access_user_id);

create index if not exists user_sessions_expires_at_idx
  on public.user_sessions (expires_at);

create table if not exists public.cdn_metrics_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  poll_window_start timestamptz,
  poll_window_end timestamptz,
  success boolean not null default false,
  request_count bigint,
  cached_request_count bigint,
  bytes_served bigint,
  error_rate numeric,
  payload jsonb not null default '{}'::jsonb,
  error_message text
);

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target_type text not null,
  target_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.access_users enable row level security;
alter table public.app_settings enable row level security;
alter table public.catalog_videos enable row level security;
alter table public.video_streams enable row level security;
alter table public.catalog_rails enable row level security;
alter table public.catalog_rail_items enable row level security;

-- Public settings can be read by authenticated clients if needed later.
drop policy if exists app_settings_authenticated_select on public.app_settings;
create policy app_settings_authenticated_select
on public.app_settings
for select
to authenticated
using (is_public = true);

drop policy if exists catalog_videos_authenticated_select on public.catalog_videos;
create policy catalog_videos_authenticated_select
on public.catalog_videos
for select
to authenticated
using (playable = true);

drop policy if exists video_streams_authenticated_select on public.video_streams;
create policy video_streams_authenticated_select
on public.video_streams
for select
to authenticated
using (is_active = true);

drop policy if exists catalog_rails_authenticated_select on public.catalog_rails;
create policy catalog_rails_authenticated_select
on public.catalog_rails
for select
to authenticated
using (is_active = true);

drop policy if exists catalog_rail_items_authenticated_select on public.catalog_rail_items;
create policy catalog_rail_items_authenticated_select
on public.catalog_rail_items
for select
to authenticated
using (true);

-- Seed data for legacy users
-- Note: Default password logic in api/auth/login.js handles initial access:
-- UserID login: password = userid
-- Email login: password = part before @
-- Admin exception: password = pdek

insert into public.access_users (email, display_name, role, subscription_tier)
values 
  ('pdek1991@gmail.com', 'PDEK 1991', 'viewer', 'premium'),
  ('pdek1992@gmail.com', 'PDEK 1992', 'viewer', 'premium')
on conflict (email) do nothing;

insert into public.access_users 
(legacy_user_id, display_name, role, subscription_tier, can_view_dashboard)
values 
  ('pdek1991', 'pdek1991', 'admin', 'premium', true),
  ('admin', 'admin', 'admin', 'premium', true),
  ('adminuser', 'adminuser', 'admin', 'premium', true),
  ('pdek1992', 'pdek1992', 'viewer', 'standard', false),
  ('jerry', 'jerry', 'viewer', 'standard', false),
  ('shankar', 'shankar', 'viewer', 'standard', false),
  ('sangram', 'sangram', 'viewer', 'standard', false),
  ('abhijeet', 'abhijeet', 'viewer', 'standard', false),
  ('avanish', 'avanish', 'viewer', 'standard', false),
  ('prakash', 'prakash', 'viewer', 'standard', false),
  ('prince', 'prince', 'viewer', 'standard', false),
  ('paresh', 'paresh', 'viewer', 'standard', false),
  ('akshay', 'akshay', 'viewer', 'standard', false),
  ('ameet', 'ameet', 'viewer', 'standard', false)
on conflict (legacy_user_id) do nothing;
