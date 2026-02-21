# Sourab Mandal — Academic Portfolio

## Admin Login

**Password: `Sourab@2024`**

To change it: open browser console on your site and run:
```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('YourNewPassword'))
  .then(b => console.log(Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')))
```
Copy the hash, replace ADMIN_PASSWORD_HASH in app.js, re-deploy.

---

## Supabase Setup (required for changes to persist)

### Step 1 — Fix your anon key in config.js
Go to Supabase Dashboard → Settings → API → copy the anon/public key (starts with eyJ...).
Replace the SUPABASE_ANON_KEY in config.js with the real key.

### Step 2 — Run this SQL in Supabase SQL Editor

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
  on public.site_state for select to anon using (true);

create policy "anon write"
  on public.site_state for all to anon
  using (true) with check (true);
```

### Step 3 — Deploy all 4 files to GitHub Pages
index.html, styles.css, app.js, config.js

---

## What was fixed
1. Admin login — password hash was a broken placeholder. Now works with Sourab@2024
2. No loading screen — page loads instantly, publications fetch in background
3. Persistence — Supabase RLS fixed to allow anon writes (run SQL above)
