import type { Metadata } from 'next'
import { DEEP_ANALYSIS_PRICE_EUR, NEGOTIATION_FEE_PERCENT, FREE_ANALYSIS_LIMIT } from '@/lib/pricing'

export const metadata: Metadata = {
  title: 'Help & FAQ',
  description: 'Frequently asked questions about TermLift. How vendor quote analysis works, supported file formats, the Negotiation Playbook, data privacy, and the success-based negotiation service.',
  openGraph: {
    title: 'Help & FAQ — TermLift',
    description: 'Frequently asked questions about TermLift. How vendor quote analysis works, supported file formats, and data privacy.',
  },
  alternates: { canonical: 'https://www.termlift.com/help' },
}

// Mirrors the questions in messages/*.json → helpPage.sections (structured data is English-only).
const faqItems = [
  { q: "What is TermLift?", a: "TermLift helps you negotiate better supplier deals. Drop in a quote and the free Quick Analysis gives you a deal score, the key red flags, an estimated savings range and a verdict. The Negotiation Playbook then turns that into ordered asks, fallback positions, leverage and a ready-to-send email. If you would rather not run the negotiation yourself, TermLift can negotiate it for you." },
  { q: "What is included in Quick Analysis?", a: "A deal score from 0 to 100 with its breakdown, the key red flags with their severity and why they matter, an estimated savings range, and a verdict on what is already solid. Detailed asks, fallback positions, email drafts and negotiation rounds are part of the Negotiation Playbook." },
  { q: "Is Quick Analysis really free?", a: `Yes. Try one quote without signing up. Create a free account for up to ${FREE_ANALYSIS_LIMIT} Quick Analyses. No card, no trial clock.` },
  { q: "What is the Negotiation Playbook?", a: "The execution layer for one deal: ordered negotiation asks with quantified impact, fallback positions, your leverage, what you can offer in return, must-have versus nice-to-have savings, a ready-to-send negotiation email, and every follow-up round on that deal." },
  { q: "What does the Negotiation Playbook cost?", a: `€${DEEP_ANALYSIS_PRICE_EUR}, one time, per deal. It is free during early access, and the first Playbook on any account stays free after that. There is no subscription.` },
  { q: "How does TermLift Negotiate work?", a: `You submit the deal, a negotiator confirms the scope with you and runs the back-and-forth with the supplier, and you approve the outcome. The fee is ${NEGOTIATION_FEE_PERCENT}% of verified savings, the documented difference between the original quote and the signed price. No savings, no fee.` },
  { q: "Are my uploaded quote files stored?", a: "No. Quote files are read in memory and discarded when the request ends. The extracted text stays with the deal only until the Negotiation Playbook has been built, the deal closes, or 90 days pass; the analysis stays until you delete the deal. Your documents are never used for AI training." },
  { q: "What file formats are supported?", a: "PDF, PNG, JPG, WEBP, or plain text paste. Maximum file size is 10 MB. For best results with images, make sure the text in the image is clearly readable." },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqItems.map(item => ({
              "@type": "Question",
              name: item.q,
              acceptedAnswer: {
                "@type": "Answer",
                text: item.a,
              },
            })),
          }),
        }}
      />
      {children}
    </>
  )
}
