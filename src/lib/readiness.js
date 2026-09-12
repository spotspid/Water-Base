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

// What each unresolved pick is called on screen, and which field on the job
// fixes it. The badge used to say "Pick 2", which names the size of the
// problem rather than the problem, so the reader had to open the job and
// compare its picks against the sheet to learn what the database already knew.
//
// fix is the field name the edit form focuses when the badge is clicked. It
// matches the input's name attribute, which is what makes one click land on
// the box rather than merely on the job.
// mid is the same name partway through a sentence. It is written out rather
// than lowercased on the fly, because "RO type" lowercases to "rO type" and a
// badge that misspells the field it is telling you to go and fill in is worse
// than the count it replaced.
export const PICK_FIELDS = {
  faucet_finish: { label: 'Faucet finish', mid: 'faucet finish', fix: 'faucet_finish' },
  ro_type: { label: 'RO type', mid: 'RO type', fix: 'ro_type' },
  valve_type: { label: 'Valve type', mid: 'valve type', fix: 'valve_type' },
  // A fixed line whose item was taken out of the sheet. Nothing on the job can
  // fix it, so it points at the sheet instead and says so.
  fixed: { label: 'A sheet line with no item', mid: 'a sheet line with no item', fix: '' },
}

// "Faucet finish", "Faucet finish and RO type", "Faucet finish, RO type and
// valve type".
function nameList(picks) {
  const fields = picks.map(p => PICK_FIELDS[p]).filter(Boolean)

  if (fields.length === 0) return ''
  if (fields.length === 1) return fields[0].label

  const rest = fields.slice(1).map(f => f.mid)
  if (rest.length === 1) return `${fields[0].label} and ${rest[0]}`

  return `${fields[0].label}, ${rest.slice(0, -1).join(', ')} and ${rest[rest.length - 1]}`
}

// The picks a set of facts reports, as a clean array. Absent or malformed is
// an empty array rather than a throw, because this runs on whatever the
// database returned and a badge must never be the thing that breaks a page.
export function picksOf(facts) {
  const raw = facts?.unresolved_picks
  return Array.isArray(raw) ? raw.filter(p => typeof p === 'string' && p in PICK_FIELDS) : []
}

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
      label: 'No parts list',
      picks: [],
      fix: 'system_template',
      detail: 'This job has no build sheet and no parts of its own, so there is nothing to '
        + 'load and it would install recording no parts cost at all.',
    }
  }

  if (lines === 0) {
    return {
      state: EMPTY_SHEET,
      tone: 'bad',
      label: 'No parts listed',
      picks: [],
      fix: 'system_template',
      detail: 'The parts list on this job is empty, so nothing would go on the van and it '
        + 'would install recording no parts cost at all.',
    }
  }

  if (short > 0) {
    return {
      state: SHORT,
      tone: 'bad',
      label: `Short ${shortUnits || short}`,
      picks: picksOf(facts),
      fix: '',
      detail: unresolved > 0
        ? `${plural(short, 'part is', 'parts are')} short by ${plural(shortUnits, 'unit', 'units')}, `
          + `and ${plural(unresolved, 'line', 'lines')} still need a choice, so it could be worse.`
        : `${plural(short, 'part is', 'parts are')} short by ${plural(shortUnits, 'unit', 'units')} `
          + 'once other booked jobs are counted.',
    }
  }

  if (unresolved > 0) {
    const picks = picksOf(facts)
    const named = nameList(picks)

    // Only one thing to choose means the badge can be the instruction. Several
    // means it names them all rather than falling back to a count, because
    // "Pick 3" is the exact wording this was written to get rid of.
    const label = named
      ? `${named} not chosen`
      : `${plural(unresolved, 'line', 'lines')} cannot name a part`

    return {
      state: UNRESOLVED,
      tone: 'warn',
      label,
      picks,
      // The first pick is what a click lands on. With several to choose, the
      // form opens on one of them and the rest are in front of you anyway.
      fix: picks.map(p => PICK_FIELDS[p]?.fix).find(Boolean) || '',
      detail: named
        ? `${named} ${picks.length === 1 ? 'is' : 'are'} not chosen on this job, so `
          + `${plural(unresolved, 'line', 'lines')} on its parts list cannot name a part `
          + 'and nothing is counted or claimed for them.'
        : `${plural(unresolved, 'line', 'lines')} on its parts list cannot name a part, so `
          + 'nothing is counted or claimed for them.',
    }
  }

  return {
    state: READY,
    tone: 'ok',
    label: 'Ready',
    picks: [],
    fix: '',
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
