import { attentionReasons, isTestJob, needsAttention } from '../src/lib/attention.js'
import { jobViewLink, jobViewOf } from '../src/lib/jobViews.js'

// Checks the rule behind the dashboard's Needs attention tile and the jobs list
// it opens. Each case is a way a job has quietly dropped out of, or distorted,
// the money before.
//
// Run with: npm run check:attention
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const clean = {
  status: 'scheduled', customer_name: 'Essie Goodbar', sale_price: 1099,
  parts_cost_basis: 'expected', unresolved_lines: 0, payout_amount: 200, invoice_number: 'MWP-0010',
}

const reasons = job => attentionReasons({ ...clean, ...job })

check('a complete job needs nothing', reasons({}).length === 0, reasons({}).join(' | '))
check('a zero price is flagged', reasons({ sale_price: 0 }).includes('No sale price'))
check('a null price is flagged', reasons({ sale_price: null }).includes('No sale price'))
check('an unresolved line is counted', reasons({ unresolved_lines: 3, parts_cost_basis: 'partial' })
  .includes('3 parts lines do not match a stock item'))
check('one unresolved line reads singular', reasons({ unresolved_lines: 1 })
  .includes('1 parts line does not match a stock item'))
check('no parts at all is its own reason', reasons({ parts_cost_basis: 'none' }).includes('No parts listed'))
check('pay unset on a scheduled job is flagged', reasons({ payout_amount: null }).includes('Installer pay not set'))
check('pay of zero on an installed job is flagged', reasons({ status: 'installed', payout_amount: 0 })
  .includes('Installer pay not set'))
check('pay is not demanded before booking', !reasons({ status: 'sold', payout_amount: null })
  .includes('Installer pay not set'))
check('a missing invoice number is flagged', reasons({ invoice_number: '  ' }).includes('No invoice number'))
check('a test name is flagged', isTestJob({ customer_name: 'ZZ Test - Steve Burgess' }))
check('a test invoice is flagged', isTestJob({ customer_name: 'Real Person', invoice_number: 'MWP-TEST-09' }))
check('a surname containing test letters is not', !isTestJob({ customer_name: 'Contessa Testarossa' }))
check('a cancelled job is never flagged', attentionReasons({ ...clean, status: 'cancelled', sale_price: 0 }).length === 0)
check('reasons are ordered most costly first', reasons({ customer_name: 'ZZ Test', sale_price: 0, invoice_number: '' })
  .join(' | ') === 'Test row, counts as a real sale | No sale price | No invoice number')

const list = needsAttention([clean, { ...clean, sale_price: 0 }, { ...clean, status: 'cancelled', sale_price: 0 }])
check('the list holds exactly the flagged jobs', list.length === 1, list.length)
check('an empty or missing list is empty', needsAttention(null).length === 0)

// the dashboard tile links to this view, so the list must be the count
const view = jobViewOf('attention')
const sample = [clean, { ...clean, sale_price: 0 }, { ...clean, invoice_number: '' }, { ...clean, status: 'cancelled', sale_price: 0 }]
check('the attention view exists', view !== null)
check('the view lists exactly what the tile counts', view && view.filter(sample).length === needsAttention(sample).length
  && view.filter(sample).every((j, i) => j === needsAttention(sample)[i]))
check('each row carries its reason', view && view.reasonFor({ ...clean, sale_price: 0 }) === 'No sale price')
check('the tile links to that view', jobViewLink('attention') === '/jobs?view=attention')

console.log(failed === 0
  ? '\nAll attention checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
