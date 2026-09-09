-- Negotiation Playbook purchases (Stripe Checkout, one-time, per deal).
-- A row is written by the server (service role) once Stripe confirms payment.
-- deal_id is null for a credit bought from the new-deal gate until the deal exists;
-- assigned_at marks the moment a credit was attached, so a deal deleted later
-- does not turn its purchase back into a spendable credit.
create table if not exists public.playbook_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete set null,
  assigned_at timestamptz,
  stripe_checkout_session_id text not null unique,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  amount_cents integer not null,
  currency text not null default 'eur',
  status text not null default 'paid',
  invoice_url text,
  created_at timestamptz not null default now()
);

create index if not exists playbook_purchases_user_idx on public.playbook_purchases (user_id);
create unique index if not exists playbook_purchases_deal_uidx on public.playbook_purchases (deal_id) where deal_id is not null;

alter table public.playbook_purchases enable row level security;

drop policy if exists "playbook_purchases_select_own" on public.playbook_purchases;
create policy "playbook_purchases_select_own" on public.playbook_purchases
  for select using (auth.uid() = user_id);
-- No insert/update/delete policies: only the service role writes.
