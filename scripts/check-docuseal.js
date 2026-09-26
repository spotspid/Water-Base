import {
  documentTitle, isTestDocument, nameKey, scanGaps, scheduledFromTitle, signerOf, titleName,
} from '../src/lib/docusealScan.js'

// Holds the DocuSeal gap scan to the shapes the API actually returns, taken
// from a real account listing on 2026-09-26.
//
// The rule matters because it decides what the Documents page claims is
// missing. A false positive sends somebody hunting for a job that exists; a
// false negative leaves a signed customer with no job at all, which is how
// eight signed agreements went unnoticed for a month.
//
// Run with: npm run check:docuseal
// No database, no network and no browser.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// Shaped exactly like a row from the list endpoint: submitters, template, no
// field values.
const submission = (over = {}) => ({
  id: 11577289,
  status: 'completed',
  completed_at: '2026-09-25T19:31:17.946Z',
  archived_at: null,
  template: { id: 6058122, name: 'Job Order -  Glen Hooker - 9/28/26' },
  submitters: [
    { email: 'contact@michiganwaterpros.com', name: null, role: 'Second Party' },
    { email: 'jay.awoodward@gmail.com', name: null, role: 'First Party' },
  ],
  ...over,
})

check('the title comes from the template name', documentTitle(submission()) === 'Job Order -  Glen Hooker - 9/28/26')
check('the customer comes out of the title', titleName('Job Order -  Glen Hooker - 9/28/26') === 'Glen Hooker')
check('and out of an agreement title with the date in the middle',
  titleName('Michigan Water Pros Installation Agreement - 9/22/2026 - Bruce Weislik') === 'Bruce Weislik')
check('a title with no name gives none',
  titleName('Michigan Water Pros Installation Agreement - 9/24/2026') === '')
check('the kind of document is stripped, not the part it shares with the name',
  titleName('Job Order  Bruce Weislik - 9/30/26') === 'Bruce Weislik')
check('a trailing date and note do not swallow the name',
  titleName('Job Order Samuelkutty Abraham - 9/24/26 (Updated)') === 'Samuelkutty Abraham')
check('a revised title keeps the name', titleName('Job Order Prudhvi Yalavarthi - REVISED') === 'Prudhvi Yalavarthi')
check('the signer is the party who is not us', signerOf(submission()).email === 'jay.awoodward@gmail.com')
check('the signer falls back to the name in the title', signerOf(submission()).name === 'Glen Hooker')

check('a job order title gives the scheduled day', scheduledFromTitle('Job Order - Donna Burgess - 10/2/26') === '2026-10-02')
check('a two digit day and month still parse', scheduledFromTitle('Job Order - X - 9/8/26') === '2026-09-08')
check('an agreement title is not a scheduled day',
  scheduledFromTitle('Michigan Water Pros Installation Agreement - 9/20/2026') === '')
check('a title with no date gives none', scheduledFromTitle('Job Order - Someone') === '')

check('a test send is left out', isTestDocument({ template: { name: 'Michigan Water Pros Installation Agreement - TEST - Jeff' } }))
check('the template itself is left out', isTestDocument({ template: { name: 'Job Order TEMPLATE' } }))
check('a real job order is not a test', !isTestDocument(submission()))
check('a contest of names is not a test', !isTestDocument({ template: { name: 'Job Order - Testa Rossa - 9/8/26' } }))

check('first and last name only', nameKey('April Y. Stone') === 'april stone')

const jobs = [
  { id: 'j1', customer_name: 'John Ewers', customer_email: 'john@example.com', status: 'sold' },
  { id: 'j2', customer_name: 'April Y. Stone', customer_email: null, status: 'scheduled' },
]

const listing = [
  submission({ id: 1, template: { name: 'Job Order - Glen Hooker - 9/28/26' } }),
  submission({
    id: 2,
    template: { name: 'Job Order - John Ewers - 10/9/26' },
    submitters: [{ email: 'john@example.com', name: 'John Ewers' }],
  }),
  submission({
    id: 3,
    template: { name: 'Michigan Water Pros Installation Agreement - 8/16/2026 - April Stone' },
    submitters: [{ email: 'contact@michiganwaterpros.com' }],
  }),
  submission({ id: 4, status: 'pending', completed_at: null, template: { name: 'Job Order - Nobody - 9/9/26' } }),
  submission({ id: 5, template: { name: 'Job Order TEMPLATE' } }),
  submission({ id: 6, template: { name: 'Job Order - Already Linked - 9/9/26' } }),
]

const gaps = scanGaps({ submissions: listing, jobs, linkedIds: ['6'] })

check('a signed document with no job is reported', gaps.missingJobs.map(r => r.id).join() === '1', gaps.missingJobs.map(r => r.id).join())
check('a signed document whose job exists is reported apart',
  gaps.unlinked.map(r => r.id).sort().join() === '2,3', gaps.unlinked.map(r => r.id).sort().join())
check('matching works on email', gaps.unlinked.some(r => r.id === '2' && r.jobName === 'John Ewers'))
check('and on the name in the title when there is no email',
  gaps.unlinked.some(r => r.id === '3' && r.jobName === 'April Y. Stone'))
check('an unsigned document is not a gap', !gaps.missingJobs.concat(gaps.unlinked).some(r => r.id === '4'))
check('a template is not a gap', !gaps.missingJobs.concat(gaps.unlinked).some(r => r.id === '5'))
check('an already linked document is not a gap', !gaps.missingJobs.concat(gaps.unlinked).some(r => r.id === '6'))
check('the scheduled day rides along', gaps.missingJobs[0]?.scheduledDate === '2026-09-28', gaps.missingJobs[0]?.scheduledDate)
check('nothing in, nothing out', scanGaps().missingJobs.length === 0 && scanGaps({}).unlinked.length === 0)

// The archived listing repeats rows from the live one, so the same document
// arrives twice in the same scan.
const twice = scanGaps({
  submissions: [listing[0], { ...listing[0], archived_at: '2026-09-26T00:00:00Z' }],
  jobs,
  linkedIds: [],
})
check('a document listed live and archived is reported once',
  twice.missingJobs.length === 1, twice.missingJobs.length)

console.log(failed === 0
  ? '\nAll DocuSeal scan checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
