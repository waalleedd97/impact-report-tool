create table if not exists public.profiles (
  email text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  email text not null,
  title text not null,
  level text not null check (level in ('very_high', 'high', 'medium', 'low', 'very_low')),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_email_updated_idx
  on public.reports (email, updated_at desc);

alter table public.profiles enable row level security;
alter table public.reports enable row level security;

insert into storage.buckets (id, name, public)
values ('smart-editor-assets', 'smart-editor-assets', false)
on conflict (id) do nothing;
