import Link from 'next/link'
import { AppSidebar } from '@/components/AppSidebar'
import { Sparkles, ArrowRight } from 'lucide-react'
import { DEMO_USER_EMAIL, demoProfile } from '@/lib/demo-data'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Demo — a vendor deal analysed and negotiated, no signup',
  description: 'Click around a fully-populated TermLift workspace with sample deals. No signup required.',
  robots: {
    index: true,
    follow: true,
  },
}

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-ground via-slate-25 to-white">
      <AppSidebar
        userEmail={DEMO_USER_EMAIL}
        isUpgraded={true}
        usageCount={demoProfile.usage_count}
        isAdmin={false}
        linkBase="/demo"
        demoMode={true}
      />

      <main className="min-h-screen transition-all duration-200 md:ml-[var(--sidebar-width,210px)]">
        {/* Sticky demo banner */}
        <div className="sticky top-0 z-30 border-b border-green-line bg-white/95 backdrop-blur-md shadow-[0_2px_8px_-4px_rgba(15,23,42,0.08)]">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-4 h-4 text-green-deep flex-shrink-0" />
              <span className="text-[12.5px] sm:text-[13.5px] text-ink-2 truncate">
                <span className="font-semibold">Sample data</span>
                <span className="text-ink-3"> — six example deals to explore.</span>
                <span className="hidden sm:inline text-ink-3"> Sign up to use TermLift with your own quotes.</span>
              </span>
            </div>
            <Link
              href="/login?from=demo"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12.5px] font-bold text-white whitespace-nowrap transition-all hover:shadow-lg hover:-translate-y-0.5"
              style={{ background: '#1DB954', boxShadow: '0 4px 12px -2px rgba(29,185,84,0.4)' }}
            >
              <span className="hidden sm:inline">Sign up free</span>
              <span className="sm:hidden">Sign up</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 pb-24 md:pb-8">
          {children}
        </div>
      </main>
    </div>
  )
}
