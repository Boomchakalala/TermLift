# TermLift

Procurement quote/contract negotiation copilot. See README.md for full product overview.

## Environment

Local development on Windows (not a cloud sandbox). Project lives at `C:\Users\kevin\TermLift`.

## Tech stack

- Next.js 16 (App Router) + TypeScript, React 19
- Tailwind CSS v4
- Supabase (Auth + Postgres, via `@supabase/ssr`)
- OpenAI API (GPT-4o) for analysis; `@anthropic-ai/sdk` also present
- PostHog for analytics. No billing yet: Deep Analysis is priced in `src/lib/pricing.ts` and free during early access; the old Stripe subscription tiers were removed 2026-09-06
- File processing: pdf-parse, pdfjs-dist, mammoth, tesseract.js (OCR)
- Tests: Vitest

## Running the app

```bash
npm run dev     # starts Next.js dev server via dev.sh (unsets stale OPENAI_API_KEY, runs `next dev`)
npm run build
npm run lint
npm test         # vitest run
```

Dev server runs on `http://localhost:3000` by default — no sandbox port-forwarding involved.

## Environment variables

Configured in `.env.local` (see README.md for the full list): Supabase URL/anon/service-role keys, OpenAI key, Stripe keys, PostHog key. Never commit this file or print its values.

## Tooling installed

- Supabase Claude Code plugin (`supabase@claude-plugins-official`) — not yet connected; requires Supabase CLI login/access token separate from the app's runtime keys.
- Playwright MCP server, scoped to this project.

## Key files

- `/src/lib/claude.ts` + `/src/lib/claude/*` — AI analysis logic (Anthropic; the old `openai.ts` is gone)
- `/src/lib/extract.ts` — file processing
- `/src/lib/schemas.ts` — Zod validation
- `/src/app/api/*` — API routes
- `/src/components/DealScrollView.tsx` — analysis sections renderer, wrapped by `components/deal/DealWorkspace.tsx`

## Design system (redesign, Sept 2026)

- Tokens live in `src/app/globals.css` (`--tl-*` + `@theme` utilities: `text-ink`, `bg-ground`, `border-line`, `text-green-deep`, `bg-warn-soft`…). Rule: green = money or the primary action, nothing else.
- Fonts via `next/font`: Sora (`font-display`) for headlines, Geist for body, JetBrains Mono (`.tl-label`) for tiny labels only.
- Shared primitives in `src/components/system/` — `Btn`, `Chip`, `StatTile`, `ScoreRing`, `StageRail`, `GateCard`, `PageHeader`/`PageBody`/`AppPage`, `Table`, `SectionHeading`/`Card`, `ImageSlot`. Use these before writing new UI.
- The product ladder (`src/lib/deal-stage.ts`): Quick analysis → Negotiation Playbook → Negotiate → TermLift negotiates → Closed. Same five names everywhere (`ladder.*` i18n keys). "Negotiation Playbook" is the user-facing name (since 2026-09-09) for what the code still calls Deep/Full Analysis (`deep-analysis` route, stage `full`) — keep the internal names, change only copy.
- The deal page itself runs on `src/lib/negotiation-flow.ts` (Analysis → Strategy → Round n… → Outcome): one `next` action per state, shown in the header, the phone bar and the `NextActionCard`; the rail is `components/deal/NegotiationProgress.tsx`. Full Analysis entitlement is per deal (`dealHasFullAnalysis(rounds)`), never the latest round alone.
- Deal numbers come from `src/lib/deal-metrics.ts` only; Home KPIs/insights from `src/lib/deal-insights.ts`.
- Generated-content language (`src/lib/output-language.ts`): every stored output carries `generated_locale`; a deal speaks its Round 1 language and later generation (Playbook, emails, rounds, close) uses it, never the UI cookie. Requests with no deal yet resolve locale via `resolveRequestLocale()` (cookie → body → Accept-Language). Reading a deal in the other UI language offers a one-off Haiku translation cached in `round_translations`; `rounds.output_json` is never rewritten.
- i18n: live strings are `messages/{en,fr}.json` (nested). Add new copy in both via `scripts/i18n-merge.mjs <fragment> <locale>`. `src/i18n/*.json` is a stale flat copy still read by `DealScrollView` — don't add to it.
- App pages wrap in `<AppPage>` (full-bleed) → `<PageHeader>` → `<PageBody>`. `/app/dashboard` and `/app/negotiations` redirect into Home tabs/filters.
- Public pages wrap in `<MarketingPage>` → `<PageHero>` → `<Section>`/`<LegalDoc>` → `<FinalCta>` from `src/components/marketing/MarketingPage.tsx`. Left-aligned, no gradient bands, cards only for separate objects.
- Blog posts live in `src/lib/blog.ts` / `blog-fr.ts` plus dated batch files (`blog-posts-2026-09.ts`); retired slugs get a 301 in `next.config.ts`. Audience is SaaS, IT & infrastructure, marketing spend — not consumer purchases.

## Market Benchmark (Deep Analysis, Sept 2026)

- Data: `benchmark_sources` / `benchmark_products` / `benchmark_observations` (admin-only RLS via `private.is_admin()`; `is_test` rows excluded in production unless `BENCHMARK_INCLUDE_TEST_DATA=true`). Native currency + EUR values + recorded FX rate on every observation.
- Engine: `src/lib/benchmark/` — pure, deterministic, unit-tested (`engine.test.ts`). Match levels 1-5; only same-vendor same-product (1-2) feed money ranges; 3-4 give a vendor discount signal; 5 is the curated category model, always labelled "not observed". Tukey outlier guard, weighted percentiles (fair = P30-P60, strong = P10-P30), confidence 0-100 → high/medium/low.
- Flow: `deep-analysis/route.ts` → `extractBenchmarkInput` (one Haiku call, facts only) → `computeMarketBenchmark` (service role reads) → result injected into `analyzeDealFacts` as an authoritative block → `clampInterpretation` forces the model's target/opening ask inside the evidence band. Stored on `rounds.output_json` as `benchmark_input`, `market_benchmark`, `market_benchmark_query`, `benchmark_interpretation`. Never blocks Deep Analysis.
- UI: `components/deal/MarketBenchmark.tsx` renders numbers from the engine result only; the model text is commentary. Admin entry at `/app/admin/benchmarks` (+ `/api/admin/benchmarks*`).
- Rule: the LLM may explain a benchmark, never produce one. No benchmark numbers come from prompts.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
