-- Freeze won-deal savings in the account's base currency at close time.
--
-- savings_amount stays in the deal's own currency (what the vendor quoted).
-- savings_base is that amount converted ONCE, with the rate of the day the
-- deal closed, so Home / Insights / Settings / Vendors stop drifting with FX.
-- If the account's base currency changes later, savings_base_currency no
-- longer matches and the readers fall back to a live conversion.
alter table public.deals
  add column if not exists savings_base          numeric,
  add column if not exists savings_base_currency text,
  add column if not exists savings_fx_rate       numeric,
  add column if not exists savings_frozen_at     timestamptz;

comment on column public.deals.savings_base is 'savings_amount converted to savings_base_currency at close (frozen; never recomputed)';
comment on column public.deals.savings_base_currency is 'Account base currency the freeze was made in (EUR, USD, …)';
comment on column public.deals.savings_fx_rate is 'savings_base / savings_amount — the rate used, for audit';
comment on column public.deals.savings_frozen_at is 'When the base figure was frozen (close time, or the backfill date for deals closed earlier)';
