// The quote email.
//
// A quote goes out as the customer agreement itself, sent by DocuSeal, with
// the quote written into DocuSeal's message. That keeps one sender and one
// look for everything a customer signs, and the button in the email is the
// agreement: signing it is accepting the quote. {{submitter.link}} is
// DocuSeal's own placeholder for that signing link.
//
// Pure, so scripts/check-quote.js can read what a customer would read.

// When the deposit is due, as the agreement says it. jobs.deposit_due holds one
// of these keys (a check constraint), and anything else reads as signing,
// which is what every agreement said before there was a choice.
export const DEPOSIT_DUE_PHRASE: Record<string, string> = {
  signing: 'at signing',
  '1_week': '1 week before installation',
  '72_hours': '72 hours before installation',
  '24_hours': '24 hours before installation',
}

export function depositDuePhrase(key: unknown): string {
  return DEPOSIT_DUE_PHRASE[String(key ?? '')] ?? DEPOSIT_DUE_PHRASE.signing
}

export type QuoteLine = { name: string; quantity: number }

export type QuoteInput = {
  customerName: string
  systemName: string
  salePrice: number
  depositAmount: number | null
  depositDue?: string | null
  lines: QuoteLine[]
}

const money = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Same part twice on a sheet (two filters, say) reads once with its count.
export function includedLines(rows: Array<{ item_name?: unknown; quantity?: unknown; resolved?: unknown }>): QuoteLine[] {
  const byName = new Map<string, number>()
  for (const r of rows) {
    if (r.resolved === false) continue
    const name = String(r.item_name ?? '').trim()
    if (!name) continue
    byName.set(name, (byName.get(name) ?? 0) + (Number(r.quantity) || 1))
  }
  return [...byName].map(([name, quantity]) => ({ name, quantity }))
}

export function quoteMessage(q: QuoteInput): { subject: string; body: string } {
  const first = q.customerName.trim().split(/\s+/)[0] || 'there'
  const deposit = q.depositAmount != null && q.depositAmount > 0
    ? `Deposit due ${depositDuePhrase(q.depositDue)}: ${money(q.depositAmount)}`
    : 'No deposit is due.'

  const included = q.lines.length
    ? q.lines.map(l => `- ${l.quantity > 1 ? `${l.quantity} x ` : ''}${l.name}`).join('\n')
    : '- Everything on the build sheet for this system'

  return {
    subject: `Your Michigan Water Pros quote: ${q.systemName}`,
    body: [
      `Hi ${first},`,
      '',
      `Here is your quote for the ${q.systemName}.`,
      '',
      'What is included:',
      included,
      '',
      `Price: ${money(q.salePrice)}`,
      deposit,
      '',
      'To go ahead, review and sign the agreement:',
      '{{submitter.link}}',
      '',
      'Reply to this email with any questions.',
      '',
      'Michigan Water Pros',
    ].join('\n'),
  }
}
