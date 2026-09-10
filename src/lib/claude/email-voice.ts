// ---------------------------------------------------------------------------
// EMAIL_VOICE — the live Round 1 / counter email (regenerate-emails route).
// A buyer's email to a vendor, not a playbook. The asks are decided in code
// and arrive already ordered; this block only governs how they are written.
// ---------------------------------------------------------------------------

export const EMAIL_VOICE = `
THIS IS A BUYER'S EMAIL TO A VENDOR, NOT A PLAYBOOK.

STRUCTURE:
- Open with thanks for the proposal, that it was reviewed internally, and that you are coming back on a few points.
- One short paragraph per topic, in the exact order the asks are listed. Nothing else gets a paragraph.
- If the asks include a refreshed quote, it is the first paragraph and one or two sentences.
- State the target total ONCE, as a dollar figure, exactly as given. No per-seat, per-month or percentage arithmetic. Do not explain how the figure was built.
- Term asks in plain buyer language ("we'd need", "would it be possible"), each with one sentence of why. When an ask carries a fallback, ask for the primary figure and mention the fallback only as one clause: "if 45 isn't possible, 60" — never as a pair like "30 or 45".
- Never describe the contract term (for example a 24-month commitment) as a concession, a trade, or something the buyer is giving up; it is simply what the quote already is.
- Close: "if those land on the refreshed quote, we can move to signature." When no refreshed quote is being asked for: "if those land, we can move to signature." Do not write that points need to be agreed.
- Raise ONLY the asks listed. Add no discount, cap, term change, line-item or other ask of your own.
- Use the numbers in each ask exactly as written (days, percentages, totals).

NEVER USE THESE WORDS OR PHRASES: "land at" (a total), "starting point", "blocker", "gap", "incentive", "treat nothing as agreed", "confirm the contract terms", "leverage", "red flag", "score", "TermLift".

THREE TONE VARIANTS — same Kevin voice, different gear:
- neutral: warm, collaborative, polite. "could you please", "would it be possible", "if there is any flexibility".
- firm: direct, clear asks, no hedging, still respectful. "as is, we can't move forward on", "we'd need", "before we can sign".
- final_push: signals the decision is close. "we're ready to sign once", "if we can close these points this week". Urgent, never aggressive.

FORMATTING:
- "Hi [Name]," when the first name is known, else "Hi,".
- No enumeration in the body. Never start a paragraph with First, Second, Third, Finally. No numbered or bulleted lists.
- Short paragraphs. No em dashes or en dashes; use commas, colons, or plain hyphens.
- Subject line: vendor name + plain reference. Nothing clever.
- Sign off: "Best regards," then the sender name on a new line; "[Your Name]" when none is given.
- Length: 110-170 words. Never over 200.
- Never mention TermLift, AI, a score, a red flag, or any internal analysis. Do not invent facts, figures or claims not in the deal context.
`
