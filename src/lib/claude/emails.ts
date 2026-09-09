import { createTrackedMessage, CLAUDE_MODEL, getResponseText, parseJsonFromContent, getLanguageInstruction } from './client'
import type { DealOutputType } from '../schemas'
import type { DealOutput, DealOutputV2 } from '@/types'
import { buildCandidateAsks, defaultSelectedLabels, getCanOffer } from '../email-asks'

// ---------------------------------------------------------------------------
// KEVIN'S VOICE — system prompt used for all email generation
// ---------------------------------------------------------------------------

export const KEVIN_SYSTEM_PROMPT = `You are generating vendor-facing procurement emails in Kevin O'Dea's style.

Your job is not only to write a good procurement email. Your job is to write an email that sounds like Kevin, thinks like Kevin, and follows Kevin's usual procurement logic.

Kevin is a corporate procurement buyer. His emails are practical, direct, polite, and business-friendly. He is not overly formal, not too legal, not robotic, and not overly enthusiastic. He writes like a real buyer trying to move a supplier process forward.

Core Kevin style:
- Start with a simple greeting and a short thank you.
- Use natural wording like "Hope all is well", "Thanks for getting back to me", "Thanks for the proposal", "After discussing internally".
- Keep the tone polite but direct.
- Do not sound like a lawyer or consultant.
- Do not sound like an AI assistant.
- Do not over-polish the email.
- Avoid dramatic wording.
- Avoid exaggerated enthusiasm.
- Avoid over-explaining.
- Use simple buyer language.
- Use short paragraphs.
- Keep the email easy to send with minimal editing.
- Focus on practical next steps.
- Make the vendor understand what is needed to move forward.

Kevin's writing rhythm:
Short intro → Context → Practical ask → Reason linked to internal process, budget, legal review, approval, or timeline → Clear next step → Polite close.

Kevin's preferred phrases:
"Hope all is well" / "Hope you are doing well" / "Thanks for getting back to me" / "Thanks for your quick response" / "Thanks for the proposal" / "After discussing internally" / "Following our call" / "As discussed" / "As is" / "Could you please" / "Would it be possible" / "If there is any flexibility" / "From there" / "On my side" / "Before we can sign" / "To move forward" / "For review/approval" / "Please let me know" / "Thanks in advance" / "Best regards"

Avoid these phrases — they do not sound like Kevin:
"We are genuinely excited" / "This is commercially compelling" / "Preserving leverage" / "Material exposure" / "The main thing holding us up" / "We require immediate remediation" / "This creates unacceptable risk" / "Pursuant to" / "Kindly revert" / "I would like to bring to your attention" / "We hereby request" / "Strategically advantageous" / "Unlock value" / "Robust commercial framework" / "In order to optimize the contractual posture"

Kevin does not write like: a lawyer, a consultant, a sales rep, an AI assistant, a corporate comms person, or someone trying to sound impressive.
Kevin writes like: a buyer managing a real process, someone trying to get the vendor to do the next useful thing, someone balancing price, legal, budget, timing and signature, someone polite but not afraid to push back.

Final self-check before output:
- Does this sound like Kevin?
- Is it practical?
- Is it clear?
- Is it too long?
- Is it too legal?
- Is it too robotic?
- Is it raising too many points?
- Are the asks realistic?
- Does the email move the process forward?
- Would Kevin send this with minimal edits?

Return only valid JSON.

ANCHOR NUMBERS: when the email states a target total or a price you are asking for, round it to a clean figure a person would say out loud (nearest 100 below 20,000; nearest 500 below 200,000; nearest 1,000 above). Never round the individual asks, discounts or the vendor's own figures; only the total you anchor on.`

// ---------------------------------------------------------------------------
// EMAIL GENERATION RULES — injected into every generation call
// ---------------------------------------------------------------------------

export const EMAIL_RULES = `
SELECTION LOGIC — you will receive a list of all available asks. Pick the 3 most commercially important ones. Rank them in this order:
1. Price / discount / cost reduction (always the top ask if present)
2. Payment terms (net 30/60/90 — raise if it moves cash materially)
3. Signature blockers (anything preventing the deal from closing)
4. Missing documents needed for internal review (legal, security, compliance)
5. Contractual ambiguity that creates real financial risk
6. Scope mismatch or overbuying risk
7. Timeline / approval blockers

Hard rules on selection:
- Maximum 3 asks per email. If you have 3 strong ones, do not add a 4th.
- Drop asks that are minor, internal-only, or that would make the email look nitpicky.
- Never suggest a longer contract term than what is in the quote unless the deal context explicitly mentions this as a lever or the user preferences say to push longer.
- Do not raise the same point twice under different wording.
- Prefer one strong ask over two weak ones.

Kevin's negotiation logic:
- Push commercially when there is a real reason: budget constraint, fast signature, renewal timing, reduced scope, competitive options, future growth, or internal approval.
- Do not negotiate just for the sake of negotiating.
- If the proposal is close to budget, say so and ask if they can bridge the gap.
- If the contract term is too long, challenge the value of the longer commitment.
- If the scope is too high, ask for a reduced scope instead of rejecting.
- If documents are missing, ask cleanly and explain it is needed for internal/legal/security review.
- If legal review is required, frame it as an internal process, not a vendor fault.
- If something is unclear, ask for confirmation rather than accusing the vendor.
- Keep momentum: the vendor should feel that if they answer clearly, the deal can move forward.

THREE TONE VARIANTS — same Kevin voice, different gear:
- neutral: Kevin's default opening move. Warm, collaborative, polite. Uses "could you please", "would it be possible", "if there is any flexibility". First attempt, relationship-first.
- firm: Kevin being direct when needed. Clear asks, no hedging, still respectful. Vendor has dragged or the commercial gap is real. Uses "as is, we don't really see the value in...", "we are somewhat budget constrained", "before we can move forward". Same Kevin, less patience.
- final_push: Kevin going for the last squeeze. Deadline-driven, signals momentum, frames the decision clearly. Uses "we should be ready to sign shortly", "once this is clarified we can move forward quickly", "in this context, signing before [date] seems tight". Urgent but never aggressive. The vendor should feel the deal is right there if they just move.

STRUCTURE (typical Kevin email):
1. "Hi [Name]," — use first name if known, otherwise "Hi,"
2. "Hope all is well" or "Thanks for getting back to me / for sharing the proposal."
3. Quick context: "After discussing internally…" / "Following our call…" / "I reviewed this on my side…"
4. Main ask: updated quote, discount, documents, clarification, contract change, signature step.
5. Explain why: budget, legal review, internal approval, security review, deadline, scope alignment.
6. Close: "Thanks in advance", "Please let me know", "From there I should be able to move forward."

NEVER REVEAL INTERNAL ANALYSIS LANGUAGE:
- Never mention TermLift, AI, "score", "red flag", "leverage level", or any internal analysis/scoring terminology to the supplier. Write only as the buyer, using the underlying facts (price, terms, timing) naturally — never as if quoting a report.
- Do not invent facts, figures, or claims not present in the deal context provided (e.g. a competing quote, a budget figure, a deadline) unless it was explicitly supplied as real context.

FORMATTING:
- No enumeration in the body. Never start a paragraph with First, Second, Third, Finally. No numbered or bulleted lists.
- Short paragraphs. Vary paragraph length.
- No em dashes or en dashes — use commas, colons, or plain hyphens.
- Subject line: plain and specific. Vendor name + plain reference ("Re: Salesforce renewal", "Konica Minolta — follow-up on proposal"). Nothing clever.
- Sign off: "Best regards," then the sender name on a new line. Use the SENDER NAME provided in the deal context. If none is provided, write "[Your Name]". Never hardcode a real name.
- Length: aim for 120–180 words. Never over 220. Cut adjectives and recaps, never cut figures or justifications.
`

// ---------------------------------------------------------------------------
// generateEmailDrafts — standalone email generation from analysis output
// ---------------------------------------------------------------------------

export async function generateEmailDrafts(
  analysisOutput: {
    vendor: string
    vendor_product?: string
    total_commitment: string
    term: string
    contact_name?: string
    currency?: string
    verdict: string
    red_flags: Array<{ issue: string; what_to_ask_for: string; severity?: string }>
    what_to_ask_for: { must_have: string[]; nice_to_have: string[] }
    potential_savings?: any
    negotiation_plan?: { leverage_you_have?: string[]; trades_you_can_offer?: string[] }
    quick_read?: { conclusion: string }
  },
  userLocale?: string,
  senderName?: string,
): Promise<{
  neutral: { subject: string; body: string }
  firm: { subject: string; body: string }
  final_push: { subject: string; body: string }
}> {
  const candidates = buildCandidateAsks(analysisOutput)
  const selectedAsks = defaultSelectedLabels(candidates)
  const canOffer = getCanOffer(analysisOutput)

  const prompt = `Write 3 supplier-facing email variations in Kevin's style.

${EMAIL_RULES}

DEAL CONTEXT:
Vendor: ${analysisOutput.vendor}
Product/Service: ${analysisOutput.vendor_product || analysisOutput.vendor}
Contact Name: ${analysisOutput.contact_name || 'NOT AVAILABLE — use "Hi," as greeting'}
Total Commitment: ${analysisOutput.total_commitment}
Term: ${analysisOutput.term}
Currency: ${analysisOutput.currency || 'match the source quote'}
Situation: ${analysisOutput.verdict}

CRITICAL: Use ONLY the product/service name shown above. Never invent or guess a different product name.
${analysisOutput.contact_name ? `The contact's first name is "${analysisOutput.contact_name}". Use "Hi ${analysisOutput.contact_name}," as the greeting in every email.` : ''}
SENDER NAME: ${senderName || '[Your Name]'}

THE ASKS TO RAISE (these are the pre-selected priority points — raise ALL of them, in this order, first ask gets the most space):
${selectedAsks.map((a) => `- ${a}`).join('\n') || '- (none — write a short, friendly note that the buyer is happy with the proposal and ready to proceed once any final admin is confirmed)'}

WHAT THE BUYER CAN OFFER IN RETURN (trade these against the asks where they fit naturally):
${canOffer.map((c) => `- ${c}`).join('\n') || '- fast signature once the points above are settled'}

Return ONLY JSON with this structure:
{
  "email_drafts": {
    "neutral": {"subject": "...", "body": "..."},
    "firm": {"subject": "...", "body": "..."},
    "final_push": {"subject": "...", "body": "..."}
  }
}`

  try {
    const response = await createTrackedMessage('email_generate_v1', {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: KEVIN_SYSTEM_PROMPT + '\n' + getLanguageInstruction(userLocale || 'en'),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      output_config: { effort: 'medium' },
    })

    const content = getResponseText(response)
    if (!content) throw new Error('No response from AI')

    const parsed = parseJsonFromContent(content) as {
      email_drafts: {
        neutral: { subject: string; body: string }
        firm: { subject: string; body: string }
        final_push: { subject: string; body: string }
      }
    }
    return parsed.email_drafts
  } catch (error) {
    console.error('Email generation error:', error)
    throw new Error('Email generation failed. Please try again.')
  }
}

// ---------------------------------------------------------------------------
// regenerateEmailDrafts — regenerate emails from existing deep analysis
// ---------------------------------------------------------------------------

export async function regenerateEmailDrafts(
  extractedText: string,
  currentOutput: DealOutput,
  userLocale?: string,
  senderName?: string,
): Promise<DealOutputType['email_drafts']> {
  const prompt = `Write 3 supplier-facing email variations in Kevin's style.

${EMAIL_RULES}

DEAL CONTEXT:
Vendor: ${currentOutput.vendor || currentOutput.snapshot.vendor_product}
Total Commitment: ${currentOutput.snapshot.total_commitment}
Term: ${currentOutput.snapshot.term}
Situation: ${currentOutput.verdict}
SENDER NAME: ${senderName || '[Your Name]'}

Must-Have Asks:
${currentOutput.what_to_ask_for?.must_have?.join('\n') || 'None'}

Nice-to-Have Asks:
${currentOutput.what_to_ask_for?.nice_to_have?.join('\n') || 'None'}

Red Flags (for context — select only what the buyer would actually raise):
${currentOutput.red_flags?.map(f => `- ${f.issue}`).join('\n') || 'None'}

Buyer's Leverage (what they can trade or offer):
${currentOutput.negotiation_plan?.leverage_you_have?.join('\n') || 'None'}
${currentOutput.negotiation_plan?.trades_you_can_offer?.join('\n') || ''}

Conclusion: ${currentOutput.quick_read?.conclusion || currentOutput.verdict}

Return ONLY JSON with this structure:
{
  "email_drafts": {
    "neutral": {"subject": "...", "body": "..."},
    "firm": {"subject": "...", "body": "..."},
    "final_push": {"subject": "...", "body": "..."}
  }
}`

  try {
    const response = await createTrackedMessage('email_regenerate_v1', {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: KEVIN_SYSTEM_PROMPT + '\n' + getLanguageInstruction(userLocale || 'en'),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      output_config: { effort: 'medium' },
    })

    const content = getResponseText(response)
    if (!content) throw new Error('No response from AI')

    const parsed = parseJsonFromContent(content) as { email_drafts: DealOutputType['email_drafts'] }
    return parsed.email_drafts
  } catch (error) {
    console.error('Email regeneration error:', error)
    throw new Error('Email regeneration failed. Please try again.')
  }
}

// ---------------------------------------------------------------------------
// generateEmailV2 — on-demand V2 email with user controls
// ---------------------------------------------------------------------------

export async function generateEmailV2(
  analysisOutput: DealOutputV2,
  emailControls: {
    tone_preference: 'soft' | 'balanced' | 'firm'
    supplier_relationship: 'new' | 'existing' | 'renewal' | 'unknown'
    email_goal: 'clarify' | 'negotiate' | 'revise' | 'accept'
    user_notes?: string
  },
  userLocale?: string,
): Promise<{ subject: string; body: string }> {
  const { tone_preference, supplier_relationship, email_goal, user_notes } = emailControls

  const toneMap = {
    soft: 'neutral — Kevin\'s warm opening move, collaborative, relationship-first',
    balanced: 'firm — Kevin being direct when needed, clear asks, still respectful',
    firm: 'final_push — Kevin going for the last squeeze, deadline-driven, signals the deal is right there if the vendor moves',
  }

  const prompt = `Write a single supplier-facing email in Kevin's style.

${EMAIL_RULES}

DEAL CONTEXT:
Supplier: ${analysisOutput.commercial_facts.supplier}
Total Value: ${analysisOutput.commercial_facts.total_value} ${analysisOutput.commercial_facts.currency}
Term: ${analysisOutput.commercial_facts.term_length}

Dominant Issue: ${analysisOutput.dominant_issue.title} — ${analysisOutput.dominant_issue.explanation}

Priority Points:
${analysisOutput.priority_points.map(p => `- ${p.title}: ${p.recommended_direction}`).join('\n') || 'None'}

USER PREFERENCES:
Tone: ${toneMap[tone_preference]}
Relationship: ${supplier_relationship}
Goal: ${email_goal}
${user_notes ? `User Notes: ${user_notes}` : ''}

Return ONLY JSON:
{
  "subject": "...",
  "body": "..."
}`

  try {
    const response = await createTrackedMessage('email_generate_v2', {
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: KEVIN_SYSTEM_PROMPT + '\n' + getLanguageInstruction(userLocale || 'en'),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      output_config: { effort: 'medium' },
    })

    const content = getResponseText(response)
    if (!content) throw new Error('No response from AI')

    const parsed = parseJsonFromContent(content) as { subject: string; body: string }
    return { subject: parsed.subject, body: parsed.body }
  } catch (error) {
    console.error('V2 email generation error:', error)
    throw new Error('Email generation failed. Please try again.')
  }
}
