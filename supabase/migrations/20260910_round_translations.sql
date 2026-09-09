-- Cached translations of generated analysis output (2026-09-10). Additive, safe to re-run.
--
-- rounds.output_json stays the source of truth in the language it was generated in
-- (output_json.generated_locale; legacy rows infer it from their prose). When a user
-- reads a deal in the other UI language they can ask for a translation once; the
-- translated copy of that round's output_json is stored here and reused. Deleting
-- the round (or its deal) removes the copies. Never populated in bulk.

create table if not exists public.round_translations (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  locale text not null check (locale in ('en', 'fr')),
  source_locale text not null check (source_locale in ('en', 'fr')),
  output_json jsonb not null,
  model text,
  created_at timestamptz not null default now(),
  unique (round_id, locale)
);

comment on table public.round_translations is 'Translated copies of rounds.output_json per locale (lib/output-language.ts). The round keeps the original; this is a display cache.';

alter table public.round_translations enable row level security;

drop policy if exists "round_translations_select_own" on public.round_translations;
create policy "round_translations_select_own" on public.round_translations
  for select using (auth.uid() = user_id);

-- Inserts and updates happen through the service role in /api/deal/[dealId]/translate,
-- after the route has verified the deal belongs to the caller.
