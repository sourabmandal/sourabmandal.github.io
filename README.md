# Sourab Mandal site (GitHub Pages + persistent admin storage)

This version keeps the same UI but makes SCI/Scopus tags, Impact Factors, and Activities persist across devices by storing them in **Supabase**.

## 1) Create Supabase table + policies

Run this in Supabase SQL editor:

```sql
create table if not exists public.site_state (
  id int primary key,
  tags jsonb not null default '{}'::jsonb,
  impact_factors jsonb not null default '{}'::jsonb,
  activities jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.site_state (id) values (1)
on conflict (id) do nothing;

alter table public.site_state enable row level security;

create policy "public read"
on public.site_state
for select
to anon
using (true);

create policy "auth update"
on public.site_state
for update
to authenticated
using (true)
with check (true);
```

> Anyone can **read** the saved state (so visitors see your tags/IF).
> Only authenticated users can **update**.

## 2) Create your admin login user

Supabase → Authentication → Users → Create user (email + password).

## 3) Configure `config.js`

Edit `config.js`:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `ADMIN_EMAIL` (the user you created)

## 4) Deploy to GitHub Pages

Upload all files in this folder to your GitHub repo root (or `/docs` depending on your Pages settings):

- index.html
- styles.css
- app.js
- config.js
- README.md (optional)

## Notes

- If Supabase is not configured, the site still works, but saves are only in the browser (localStorage).
- Your Supabase anon key is safe to expose because Row Level Security controls access.
