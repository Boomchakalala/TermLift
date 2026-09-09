-- Security + performance pass, 2026-09-11.
--
-- 1. profiles: the authenticated role could UPDATE any column of its own row
--    through RLS, including is_admin, usage_count and the Stripe fields
--    (privilege escalation from the browser with the anon key). Column-level
--    grants now limit users to their own preferences; everything commercial or
--    privileged is written by the service role only.
-- 2. UPDATE policies gain WITH CHECK so a row cannot be re-assigned to another
--    user_id by its owner.
-- 3. auth.uid() → (select auth.uid()) in every policy (Supabase linter
--    auth_rls_initplan): evaluated once per query instead of once per row.
--    Admin EXISTS subqueries use private.is_admin() like the newer tables.
-- 4. Duplicate permissive policies on feedback dropped; duplicate indexes
--    dropped; covering indexes added for the unindexed foreign keys.

-- ── 1. profiles column grants ────────────────────────────────────────────────
revoke update on public.profiles from authenticated, anon;
grant update (contact_name, base_currency, locale, negotiation_preferences) on public.profiles to authenticated;
revoke insert on public.profiles from authenticated, anon;
grant insert (id, email, locale, contact_name, base_currency, created_at) on public.profiles to authenticated;

-- ── 2 + 3. policies ──────────────────────────────────────────────────────────
alter policy "Users can read own profile"   on public.profiles using ((select auth.uid()) = id);
alter policy "Users can update own profile" on public.profiles using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter policy "Users can insert own profile" on public.profiles with check ((select auth.uid()) = id);

alter policy "Users can read own deals"   on public.deals using ((select auth.uid()) = user_id);
alter policy "Users can create own deals" on public.deals with check ((select auth.uid()) = user_id);
alter policy "Users can update own deals" on public.deals using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users can delete own deals" on public.deals using ((select auth.uid()) = user_id);

alter policy "Users can read own rounds"   on public.rounds using ((select auth.uid()) = user_id);
alter policy "Users can create own rounds" on public.rounds with check ((select auth.uid()) = user_id);
alter policy "Users can update own rounds" on public.rounds using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users can delete own rounds" on public.rounds using ((select auth.uid()) = user_id);

alter policy "Users can read own vendors"   on public.vendors using ((select auth.uid()) = user_id);
alter policy "Users can create own vendors" on public.vendors with check ((select auth.uid()) = user_id);
alter policy "Users can update own vendors" on public.vendors using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users can delete own vendors" on public.vendors using ((select auth.uid()) = user_id);

alter policy "Users can read own vendor notes"   on public.vendor_notes using ((select auth.uid()) = user_id);
alter policy "Users can create own vendor notes" on public.vendor_notes with check ((select auth.uid()) = user_id);
alter policy "Users can update own vendor notes" on public.vendor_notes using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "Users can delete own vendor notes" on public.vendor_notes using ((select auth.uid()) = user_id);

alter policy "Users can read own negotiation requests"   on public.negotiation_requests using ((select auth.uid()) = user_id);
alter policy "Users can create own negotiation requests" on public.negotiation_requests with check ((select auth.uid()) = user_id);
alter policy "Admins can read all negotiation requests"  on public.negotiation_requests using ((select private.is_admin()));
alter policy "Admins can update negotiation requests"    on public.negotiation_requests using ((select private.is_admin())) with check ((select private.is_admin()));

alter policy "Users can read own notifications"      on public.notifications using ((select auth.uid()) = user_id);
alter policy "Users can mark own notifications read" on public.notifications using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

alter policy "ai_usage_events_select_admin"  on public.ai_usage_events using ((select private.is_admin()));
alter policy "round_translations_select_own" on public.round_translations using ((select auth.uid()) = user_id);
alter policy "playbook_purchases_select_own" on public.playbook_purchases using ((select auth.uid()) = user_id);

alter policy "Service role can read contact submissions" on public.contact_submissions using ((select auth.role()) = 'service_role');

-- feedback: one INSERT policy and one SELECT policy for users, plus the service-role read.
drop policy if exists "Users can insert own feedback" on public.feedback;
drop policy if exists "Users can read their own feedback" on public.feedback;
alter policy "Authenticated users can submit feedback" on public.feedback with check ((select auth.uid()) = user_id);
alter policy "Users can read own feedback" on public.feedback using ((select auth.uid()) = user_id);
alter policy "Service role can read all feedback" on public.feedback using ((select auth.role()) = 'service_role');

-- ── 4. indexes ───────────────────────────────────────────────────────────────
drop index if exists public.idx_contact_submissions_created;
drop index if exists public.idx_feedback_created;

create index if not exists ai_usage_events_round_id_idx on public.ai_usage_events (round_id);
create index if not exists benchmark_observations_created_by_idx on public.benchmark_observations (created_by);
create index if not exists benchmark_observations_product_id_idx on public.benchmark_observations (product_id);
create index if not exists benchmark_observations_source_id_idx on public.benchmark_observations (source_id);
create index if not exists benchmark_sources_created_by_idx on public.benchmark_sources (created_by);
create index if not exists negotiation_requests_deal_id_idx on public.negotiation_requests (deal_id);
create index if not exists negotiation_requests_round_id_idx on public.negotiation_requests (round_id);
create index if not exists round_translations_user_id_idx on public.round_translations (user_id);
create index if not exists vendor_notes_user_id_idx on public.vendor_notes (user_id);
