// Can the van be loaded for this job.
//
// The database answers this in facts: job_schedule_readiness reports whether a
// job is worth checking, whether it has a build sheet, how many lines that
// sheet carries, how many of them cannot name a part yet, and how short the
// shelf is. This turns those facts into the one thing a card can show.
//
// Pure and importing nothing, so npm run check can run it under Node. That
// matters here because the wording is the whole feature: a badge that says the
// wrong word is worse than no badge, and this is the only place the word is
// chosen.

export const READY = 'ready'
export const SHORT = 'short'
export const UNRESOLVED = 'unresolved'
export const EMPTY_SHEET = 'empty'
export const NO_SHEET = 'no_sheet'

// Worst first. A job can be several of these at once, and the badge shows one,
// so the order is the decision about which one an operator needs to see.
//
// Short outranks unresolved because a shortage is concrete: the part is named
// and the shelf does not have it. Unresolved outranks nothing, but it is a
// decision waiting rather than a problem, which is why it is amber.
//
// An empty sheet outranks a shortage because it is the trap: nothing to
// resolve cannot fail, so an empty sheet reports zero shortages and would read
// as the readiest job on the board.
const ORDER = [NO_SHEET, EMPTY_SHEET, SHORT, UNRESOLVED, READY]

function count(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

/**
 * The readiness of one job, or null when there is nothing to say.
 *
 * Null in three cases, and all three mean "show no badge" rather than "ready":
 *
 *   no facts     the readiness call failed, or this job was not in the answer.
 *                Silence is right here. Painting a green Ready because a
 *                request failed is the specific way this feature could do
 *                harm, so absence never resolves to good news.
 *   not checked  the job is installed or cancelled. Its parts are consumed or
 *                released and there is no question left to ask.
 *   no sheet     handled below rather than here, because a scheduled job with
 *                no build sheet is worth saying out loud.
 */
export function readinessOf(facts) {
  if (!facts) return null
  if (facts.checked === false) return null

  const short = count(facts.short_items)
  const shortUnits = count(facts.short_units)
  const unresolved = count(facts.unresolved_lines)
  const lines = count(facts.sheet_lines)
  const hasSheet = facts.has_sheet !== false

  if (!hasSheet) {
    return {
      state: NO_SHEET,
      tone: 'bad',
      label: 'No sheet',
      detail: 'This job has no build sheet, so there is no parts list to load.',
    }
  }

  if (lines === 0) {
    return {
      state: EMPTY_SHEET,
      tone: 'bad',
      label: 'Empty sheet',
      detail: 'The build sheet on this job has no parts on it, so nothing would go on the van.',
    }
  }

  if (short > 0) {
    return {
      state: SHORT,
      tone: 'bad',
      label: `Short ${shortUnits || short}`,
      detail: unresolved > 0
        ? `${plural(short, 'part is', 'parts are')} short by ${plural(shortUnits, 'unit', 'units')}, `
          + `and ${plural(unresolved, 'line', 'lines')} still need a choice, so it could be worse.`
        : `${plural(short, 'part is', 'parts are')} short by ${plural(shortUnits, 'unit', 'units')} `
          + 'once other booked jobs are counted.',
    }
  }

  if (unresolved > 0) {
    return {
      state: UNRESOLVED,
      tone: 'warn',
      label: `Pick ${unresolved}`,
      detail: `${plural(unresolved, 'line', 'lines')} on the build sheet cannot name a part until `
        + 'the finish or the RO type is chosen, so the parts are not counted yet.',
    }
  }

  return {
    state: READY,
    tone: 'ok',
    label: 'Ready',
    detail: `All ${plural(lines, 'part', 'parts')} on the build sheet are free and on the shelf.`,
  }
}

// "1 part is" / "3 parts are", so the detail line reads as a sentence
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Facts keyed by job id, from the rows the readiness call returns.
 *
 * A plain object rather than a Map so it can be held in state and compared
 * cheaply, and so a missing job is undefined rather than throwing.
 */
export function readinessByJob(rows) {
  const out = {}
  for (const row of rows || []) {
    if (row?.job_id) out[row.job_id] = row
  }
  return out
}

/**
 * The worst readiness across a set of jobs, for a day header.
 *
 * Jobs with nothing to say are skipped rather than counted as ready, so a day
 * of installed jobs reports nothing instead of a green tick it has not earned.
 */
export function worstOf(list) {
  let worst = null

  for (const item of list || []) {
    const r = item && item.state ? item : readinessOf(item)
    if (!r) continue
    if (!worst || ORDER.indexOf(r.state) < ORDER.indexOf(worst.state)) worst = r
  }

  return worst
}

/**
 * How many of a day's jobs are ready, and how many had an answer at all.
 *
 * Both numbers matter. "2 of 3 ready" and "2 ready" say different things when
 * the third job's readiness could not be loaded.
 */
export function readyCount(list) {
  let ready = 0
  let known = 0

  for (const item of list || []) {
    const r = item && item.state ? item : readinessOf(item)
    if (!r) continue
    known += 1
    if (r.state === READY) ready += 1
  }

  return { ready, known }
}
