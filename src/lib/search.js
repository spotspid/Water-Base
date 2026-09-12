// Finding a job by typing part of it.
//
// There was no search anywhere in the app. With nine jobs that is a scroll;
// with three hundred it is the reason somebody keeps a spreadsheet beside the
// software that was supposed to replace it.
//
// Three fields, because those are the three things anyone knows about a job
// when they go looking for it: who it is for, where it is, and the number on
// the paperwork.
//
// Pure and importing nothing, so npm run check can run it under Node. Matching
// rules are exactly the kind of thing that looks obviously right and quietly
// is not, so they are tested rather than trusted.

// Everything lowercased, with runs of whitespace collapsed, so a trailing
// space or a double space between first and last name does not miss.
function normalise(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Invoice numbers are written three ways for the same job: "MWP 005",
// "MWP-005", "mwp005". Stripping everything that is not a letter or a digit
// makes all three the same string, so typing any of them finds the job.
function loose(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Whether a job matches what was typed.
 *
 * An empty query matches everything, which is what makes the search box safe
 * to leave empty rather than a filter you have to remember to clear.
 *
 * Every term has to match something, but they may match different fields, so
 * "toomey kettle" finds the job by surname and street together. That is how
 * people actually remember a job, and requiring one field to hold both would
 * fail on exactly the case the search exists for.
 */
export function matchesJob(job, query) {
  const terms = normalise(query).split(' ').filter(Boolean)
  if (terms.length === 0) return true
  if (!job) return false

  const haystack = [
    normalise(job.customer_name),
    normalise(job.address),
    normalise(job.city),
    normalise(job.invoice_number),
  ].filter(Boolean)

  const looseInvoice = loose(job.invoice_number)

  return terms.every(term => {
    if (haystack.some(field => field.includes(term))) return true

    // "mwp005" against "MWP 005". Only worth trying when the term has
    // something in it once the punctuation is gone.
    const bare = loose(term)
    return bare.length > 0 && looseInvoice.length > 0 && looseInvoice.includes(bare)
  })
}

/**
 * Filter a list of jobs by a query.
 *
 * Returns the same array when there is nothing to search for, so React sees
 * the same reference and does not re-render the table over an empty box.
 */
export function searchJobs(jobs, query) {
  const list = jobs || []
  if (normalise(query) === '') return list
  return list.filter(job => matchesJob(job, query))
}
