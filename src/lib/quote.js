// What a quote is, away from the screen that draws it.
//
// Kept apart from the page so the arithmetic can be read and tested without a
// browser, and so the page has nothing to do but render what it is handed.

export const STATUSES = ['quoted', 'sold', 'scheduled', 'installed', 'cancelled']

// Only a name. Everything else can be blank, and that is the point rather than
// an oversight: a quote often begins as a name and a phone number, and a form
// that refuses to save what somebody actually knows sends them to do the work
// somewhere else. On 2026-10-10 that is exactly what happened, and a $3,399
// sale went through DocuSeal without Water Base ever hearing about it.
export function whatIsMissing(form) {
  if (!String(form?.customer_name ?? '').trim()) return 'A name, so there is something to call this.'
  return ''
}

// An email is needed to send, which is different from being needed to save.
export function canSend(form) {
  return !whatIsMissing(form) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(form?.customer_email ?? '').trim())
}

export function money(value) {
  // Nothing is not zero. Number(null) is 0 and Number('') is 0, both finite,
  // so a blank would read as $0.00 and a price nobody has set would look like
  // a price of nothing. check:quote caught this on the first run.
  if (value === null || value === undefined || String(value).trim() === '') return ''

  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })
}

/**
 * The total, and the lines behind it.
 *
 * A preset with no price contributes nothing rather than zero, and says so.
 * Filtration Only and Custom both have no price today, and a page that treated
 * a blank as nought would quietly quote somebody $550 for a whole home system
 * plus a reroute.
 */
export function quoteLines(preset, chosenExtras) {
  const lines = []

  if (preset) {
    lines.push({
      key: `preset:${preset.id}`,
      label: preset.name,
      amount: preset.price == null ? null : Number(preset.price),
    })
  }

  for (const extra of chosenExtras || []) {
    lines.push({ key: `extra:${extra.id}`, label: extra.label, amount: Number(extra.price) || 0 })
  }

  const priced = lines.filter(line => line.amount != null)
  const total = priced.reduce((sum, line) => sum + line.amount, 0)

  return {
    lines,
    total,
    // True when something on the quote has no price, so the figure shown is
    // the sum of what is known rather than the price of the job.
    incomplete: lines.some(line => line.amount == null),
  }
}

// The row as the form wants it: every value a string, because that is what an
// input holds and null renders as the word null.
export function emptyForm() {
  return {
    customer_name: '',
    phone: '',
    customer_email: '',
    address: '',
    city: '',
    water_source: '',
    water_problems: '',
    people_in_home: '',
    bathrooms: '',
    system_name: '',
    system_description: '',
    parts_list: '',
    faucet_finish: '',
    ro_type: '',
    valve_type: '',
    sale_price: '',
    deposit_amount: '',
    collected_by: '',
    site_conditions: '',
    notes: '',
  }
}

/**
 * The checklist, grouped by what kind of answer the question wants.
 *
 * The live form splits it into Sizing and Site, which is the order somebody
 * walks the house. That is a fine order and a useless grouping for acting on,
 * because Site holds four questions you answer by looking and three you
 * answer by measuring, and no single button can serve both.
 *
 * Grouped by the answer instead:
 *
 *   sizing    two numbers that decide which system to quote at all
 *   checks    four things you look at and say yes or no to, so one button can
 *             clear all of them honestly: you did look, and it was fine
 *   plumbing  four things you have to find out, where the only honest bulk
 *             answer is that nobody knows yet
 *
 * Each group gets the one action that is true for it. A blanket yes on a
 * measurement would be invention; a blanket not sure on a receptacle you are
 * standing in front of is just lazy.
 */
export const QUOTE_CHECKLIST_SECTIONS = [
  {
    id: 'sizing',
    title: 'Sizing',
    note: 'Decides which system to quote.',
    keys: ['people_in_home', 'bathrooms'],
    bulk: null,
  },
  {
    id: 'checks',
    title: 'Quick checks',
    note: 'Things you can answer by looking.',
    keys: ['space_confirmed', 'receptacle_within_6ft', 'irrigation_lines', 'removing_old_equipment'],
    bulk: 'yes',
    bulkLabel: 'All clear',
  },
  {
    id: 'plumbing',
    title: 'Plumbing',
    note: 'What the installer needs to plan the job.',
    keys: ['shutoff_location', 'drain_distance_ft', 'main_line_size', 'main_line_material'],
    bulk: 'not_sure',
    bulkLabel: 'Not sure yet on the rest',
  },
]
