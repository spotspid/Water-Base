import { includedLines, quoteMessage } from '../supabase/functions/send-agreement/quote.ts'

// What a customer reads in the quote email. Run with: npm run check:quote

let failed = 0
function check(name, ok, detail = '') {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!ok) failed++
}

const lines = includedLines([
  { item_name: 'Sediment filter', quantity: 1, resolved: true },
  { item_name: 'Sediment filter', quantity: 1, resolved: true },
  { item_name: 'Brushed nickel faucet', quantity: 1, resolved: true },
  { item_name: 'Unknown valve', quantity: 1, resolved: false },
])
check('a part listed twice reads once with its count', lines.length === 2 && lines[0].quantity === 2, JSON.stringify(lines))
check('an unresolved line is not promised to the customer', !lines.some(l => l.name === 'Unknown valve'))

const q = quoteMessage({ customerName: 'Steve Burgess', systemName: 'Flagship Bundle', salePrice: 2999, depositAmount: 899.7, lines })
check('the subject names the system', q.subject.includes('Flagship Bundle'), q.subject)
check('the price is in the body', q.body.includes('$2,999.00'))
check('the deposit due at signing is in the body', q.body.includes('Deposit due at signing: $899.70'))
check('the included parts are listed', q.body.includes('- 2 x Sediment filter'))
check('the signing link is the DocuSeal placeholder', q.body.includes('{{submitter.link}}'))
check('no deposit says so rather than $0.00',
  quoteMessage({ customerName: 'A', systemName: 'S', salePrice: 1, depositAmount: 0, lines: [] }).body.includes('No deposit is due at signing.'))

console.log(failed === 0 ? '\nAll quote checks passed.\n' : `\n${failed} quote checks failed.\n`)
process.exit(failed === 0 ? 0 : 1)
