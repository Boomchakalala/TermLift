'use client'

import { useState } from 'react'
import { Search, Rocket, Upload, BarChart3, FolderOpen, Shield, CreditCard, ChevronDown, Mail } from 'lucide-react'
import { AppPage, PageHeader } from '@/components/system'

type Category = 'getting-started' | 'uploading' | 'output' | 'deals' | 'privacy' | 'billing'

const categories: { key: Category; name: string; icon: React.ReactNode; sub: string }[] = [
  { key: 'getting-started', name: 'Getting started', icon: <Rocket className="w-4 h-4" />, sub: 'What TermLift does and how it works' },
  { key: 'uploading', name: 'Uploading quotes', icon: <Upload className="w-4 h-4" />, sub: 'How to get your vendor quotes in' },
  { key: 'output', name: 'Analysis output', icon: <BarChart3 className="w-4 h-4" />, sub: 'What you get back and how to use it' },
  { key: 'deals', name: 'Deals & tracking', icon: <FolderOpen className="w-4 h-4" />, sub: 'Managing deals, rounds, and outcomes' },
  { key: 'privacy', name: 'Privacy & data', icon: <Shield className="w-4 h-4" />, sub: 'How we handle your documents' },
  { key: 'billing', name: 'Account & billing', icon: <CreditCard className="w-4 h-4" />, sub: 'Plans, pricing, and account management' },
]

const faqData: Record<Category, { q: string; a: string }[]> = {
  'getting-started': [
    { q: 'What is TermLift?', a: 'TermLift helps you find and act on negotiation opportunities in supplier quotes. Upload a quote and you get a fast initial assessment (score, red flags, potential savings) in a couple of minutes. From there you can build the Negotiation Playbook \u2014 the ordered asks, fallback positions and leverage \u2014 then either negotiate it yourself or have TermLift negotiate it for you.' },
    { q: 'How does the AI analysis work?', a: "Text is extracted from your document (PDF, image, or pasted text) and sent to Anthropic\u2019s Claude AI, prompted specifically for procurement analysis. It reads the full content, identifies risks, estimates savings potential, and builds the negotiation playbook." },
    { q: 'What file formats are supported?', a: 'PDF, PNG, JPG, WEBP, or plain text paste. Maximum file size is 10 MB. For images, make sure the text is clearly readable. Multi-page PDFs are fully supported \u2014 every page is analyzed.' },
    { q: 'Do I need procurement experience?', a: "No. TermLift is designed for anyone who negotiates vendor contracts \u2014 from first-timers to procurement pros. The AI provides specific asks, fallback positions, and ready-to-send emails so you know exactly what to say." },
  ],
  'uploading': [
    { q: 'How do I upload a quote?', a: "Go to New Analysis, then either drag and drop a file onto the upload area, click \u2018Browse files\u2019 to select one, or paste the contract text directly into the text box. The AI handles all formats automatically." },
    { q: 'Can I analyze an email from a vendor?', a: 'Yes. Copy the full email text \u2014 subject line, body, pricing tables, terms \u2014 and paste it into the text input. TermLift will analyze everything including inline pricing and conditions.' },
    { q: 'What if my PDF has images or complex tables?', a: 'TermLift uses vision AI to read PDFs with images, scanned pages, and complex table layouts. If the text extraction seems off, try pasting the key sections as plain text for more reliable results.' },
  ],
  'output': [
    { q: 'What do I get back from an analysis?', a: 'The initial analysis gives you a 0\u2013100 deal score with breakdown (pricing, terms, leverage), your top red flags, and a realistic savings estimate \u2014 usually within a couple of minutes. Building the Negotiation Playbook adds the execution layer: every red flag with specific asks and fallback positions, must-have vs. nice-to-have savings, what you can offer, and your negotiation levers. From there you can generate a ready-to-send email yourself, or have TermLift negotiate it for you.' },
    { q: 'What are the three email tones?', a: 'Friendly (warm and collaborative \u2014 good for relationships you want to preserve), Direct (clear and professional \u2014 gets to the point), and Firm (assertive with deadlines \u2014 for when you have leverage or urgency). Pick the one that fits your vendor relationship.' },
    { q: 'How accurate is the AI?', a: 'The AI is good but not perfect. It can miss details, misinterpret terms, or make errors \u2014 especially with complex legal language or unusual contract structures. Always review the outputs against your original documents. Use it as a starting point, not the final word.' },
  ],
  'deals': [
    { q: 'How do I close a deal?', a: "Click \u2018Close deal\u2019 on the deal page. You\u2019ll be asked to enter the final agreed price and select what changed (price reduction, better terms, added scope, etc.). TermLift calculates your actual savings and tracks them in your dashboard." },
    { q: 'Can I do multiple negotiation rounds?', a: "Yes. Once the Negotiation Playbook is built for a deal, you can upload the vendor\u2019s counter-offer as a new round. TermLift re-analyzes the updated terms and adjusts its recommendations \u2014 rounds belong to the deal, not to a subscription." },
    { q: 'How are savings calculated?', a: 'Savings are calculated by comparing the original quoted price to the final agreed price when you close the deal. The potential savings shown during analysis are estimates based on market benchmarks and the specific issues found in your quote.' },
  ],
  'privacy': [
    { q: 'Is my data private?', a: "Yes. Quote files are read in memory and never stored. Your deal data is encrypted in transit (TLS) and at rest, and your documents are never used for AI training. Anthropic processes the extracted text under its API terms and does not train on it." },
    { q: 'Are my documents stored?', a: 'Quote files (PDFs, images) are never stored. The text we extract stays with the deal only until the Negotiation Playbook has been built, the deal closes, or 90 days pass; the analysis and the structured deal facts stay until you delete the deal. A document you attach for the negotiation service is kept with your consent and removed 30 days after the case closes, or 12 months after upload at the latest.' },
    { q: 'Can I delete all my data?', a: "Yes. Go to Settings \u2192 Danger Zone and click \u2018Delete account.\u2019 Your account, deals, analysis history and any negotiation documents are removed immediately. De-identified benchmark rows built from closed deals carry no link to your account and remain. This action cannot be undone." },
  ],
  'billing': [
    { q: 'Is Quick Analysis really free?', a: 'Yes. No card, no trial clock. One quote can be analysed without an account; a free account gives you up to 4 Quick Analyses. Playbooks, emails and rounds on your existing deals never count against that number.' },
    { q: 'What does the Negotiation Playbook cost? Is it per deal?', a: '€29, one time, per deal. It covers everything on that deal: the asks, fallbacks, leverage, the email and every follow-up round. During early access it is free, and the first Playbook on any account stays free after that. There is no subscription.' },
    { q: 'How does TermLift Negotiate work, and how is the 20% fee calculated?', a: 'You submit the deal, a negotiator confirms the scope with you and runs the back-and-forth with the supplier, and you approve the outcome. The fee is 20% of verified savings with a €500 minimum, invoiced once the contract is signed. Verified savings are the documented difference between the original written quote and the signed price for the same scope and term. No savings, no fee.' },
    { q: 'Does TermLift contact vendors without my approval?', a: 'No. We only contact the supplier after you have submitted a negotiation request and confirmed the scope with us. Nothing is agreed without your explicit approval, and you sign the contract yourself.' },
  ],
}

export default function AppHelpPage() {
  const [activeCategory, setActiveCategory] = useState<Category>('getting-started')
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')

  const toggleItem = (key: string) => setOpenItems(prev => ({ ...prev, [key]: !prev[key] }))

  const currentCat = categories.find(c => c.key === activeCategory)!

  // When searching, scan all categories and tag results with their source
  const allFaqs = Object.entries(faqData).flatMap(([catKey, items]) =>
    items.map(f => ({ ...f, catKey: catKey as Category }))
  )
  const isSearching = search.trim().length > 0
  const filteredFaqs = isSearching
    ? allFaqs.filter(f => f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase()))
    : faqData[activeCategory].map(f => ({ ...f, catKey: activeCategory }))

  return (
    <AppPage>
      <PageHeader
        title="Help Center"
        actions={
          <label className="relative block w-full sm:w-[260px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search help articles…"
              className="w-full h-9 pl-9 pr-3 text-[13px] bg-surface border border-line rounded-lg placeholder:text-ink-3 focus:outline-none focus:border-green focus:ring-[3px] focus:ring-green/15"
            />
          </label>
        }
      />

      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        {/* Left nav */}
        <div className="md:w-[220px] flex-shrink-0 bg-surface border-b md:border-b-0 md:border-r border-line px-3 py-4">
          <p className="px-2.5 mb-2 tl-label text-ink-3 text-[10px]">Topics</p>
          <nav className="space-y-0.5">
            {categories.map(cat => (
              <button
                key={cat.key}
                onClick={() => { setActiveCategory(cat.key as Category); setSearch('') }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors text-left ${
                  activeCategory === cat.key
                    ? 'bg-green-soft text-green-deep font-semibold'
                    : 'text-ink-2 hover:bg-ground hover:text-ink'
                }`}
              >
                <span className={`flex-shrink-0 ${activeCategory === cat.key ? 'text-green-deep' : 'text-ink-3'}`}>{cat.icon}</span>
                {cat.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 sm:px-6 py-5 bg-ground pb-24 md:pb-10">
          <div className="max-w-3xl">
            {/* Category header */}
            {!isSearching && (
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-[10px] bg-green-soft flex items-center justify-center text-green-deep">
                  {currentCat.icon}
                </div>
                <div>
                  <h2 className="text-[20px] font-bold text-ink font-display">{currentCat.name}</h2>
                  <p className="text-[13px] text-ink-3">{currentCat.sub}</p>
                </div>
              </div>
            )}
            {isSearching && (
              <div className="flex items-center justify-between mb-6">
                <p className="text-[14px] font-semibold text-ink-2">
                  {filteredFaqs.length} result{filteredFaqs.length !== 1 ? 's' : ''} for &ldquo;{search}&rdquo;
                </p>
                <button onClick={() => setSearch('')} className="text-[13px] text-green-deep font-medium hover:underline">
                  Clear
                </button>
              </div>
            )}

            {/* FAQ items */}
            <div className="bg-surface border border-line rounded-[14px] overflow-hidden">
              {filteredFaqs.length > 0 ? filteredFaqs.map((item, i) => {
                const key = `${item.catKey}-${item.q}`
                const isOpen = !!openItems[key]
                const itemCat = categories.find(c => c.key === item.catKey)
                return (
                  <div
                    key={key}
                    className={`${i < filteredFaqs.length - 1 ? 'border-b border-line-2' : ''}`}
                  >
                    <button
                      onClick={() => toggleItem(key)}
                      className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-surface-2 transition-colors"
                    >
                      <div className="pr-4">
                        {isSearching && itemCat && (
                          <span className="text-[10px] font-bold text-ink-3 uppercase tracking-wider block mb-1">{itemCat.name}</span>
                        )}
                        <span className="text-[14px] font-semibold text-ink">{item.q}</span>
                      </div>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${isOpen ? 'bg-green-soft' : 'bg-surface-2'}`}>
                        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180 text-green-deep' : 'text-ink-3'}`} />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-6 pb-5">
                        <p className="text-[14px] text-ink-2 leading-relaxed">{item.a}</p>
                      </div>
                    )}
                  </div>
                )
              }) : (
                <div className="px-6 py-12 text-center">
                  <p className="text-[14px] text-ink-3">No results for &ldquo;{search}&rdquo;</p>
                  <button onClick={() => setSearch('')} className="text-[13px] text-green-deep font-medium mt-2 hover:underline">Clear search</button>
                </div>
              )}
            </div>

            {/* Still have questions */}
            <div className="bg-surface border border-line rounded-[14px] p-5 mt-4 flex flex-wrap gap-3 items-center justify-between">
              <div>
                <p className="text-[15px] font-bold text-ink mb-1">Still have questions?</p>
                <p className="text-[13px] text-ink-3">We&apos;re here to help &mdash; reach out anytime</p>
              </div>
              <a
                href="mailto:hello@termlift.com"
                className="inline-flex items-center gap-2 text-[13px] font-semibold text-green-deep bg-green-soft border border-green-line px-5 py-2.5 rounded-[10px] hover:bg-green-soft transition-colors"
              >
                <Mail className="w-4 h-4" />hello@termlift.com
              </a>
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  )
}

