// The sales checklist, from the Sept 17 call.
//
// What the salesperson has to find out at the kitchen table so the install
// does not turn into a second visit: how many people use the water, where the
// shutoff is, whether there is room, power and a drain where the system goes,
// whether irrigation is on the line, and whether old equipment comes out.
//
// Stored as jobs.sales_checklist, one jsonb object. The three choices that
// already have columns (faucet finish, RO type, payment type) are not copied
// into it: they are part of the checklist on screen and read from the job, so
// there is one place each answer lives.
//
// Unanswered is not the same as no. A blank "power at intake" means nobody
// asked, and that is what goes amber. Saving is never blocked: a quote goes
// out with gaps all the time, and the amber is there so the gaps are chased
// before the install rather than discovered at it.
//
// Pure and importing nothing, so npm run check can run it under Node.

export const YES = 'yes'
export const NO = 'no'
export const UNKNOWN = 'unknown'

// The order is the order the questions get asked in a house.
export const CHECKLIST_ITEMS = [
  { key: 'people_in_home', label: 'People in home', kind: 'count' },
  { key: 'bathrooms', label: 'Bathrooms', kind: 'count' },
  { key: 'shutoff_location', label: 'Main water shutoff location', kind: 'text' },
  { key: 'space_confirmed', label: 'Space confirmed for the unit', kind: 'yesno' },
  { key: 'power_at_intake', label: 'Power at intake', kind: 'yesno' },
  { key: 'drain_at_intake', label: 'Drain at intake', kind: 'yesno' },
  { key: 'irrigation_lines', label: 'Irrigation lines', kind: 'yesnounknown' },
  { key: 'removing_old_equipment', label: 'Removing old equipment', kind: 'yesno' },
]

// The two halves of the checklist as the New quote form lays them out.
//
// Both come before the system choice. Sizing is first because it decides which
// system to quote: how many people, how many bathrooms, whether the unit fits.
// Site follows it, because it is asked in the same walk round the house, before
// anyone picks equipment. They stay two sections so each counts its own gaps.
// The drawer shows all of them in one block and ignores this.
export const SIZING_KEYS = ['people_in_home', 'bathrooms', 'space_confirmed']
export const SITE_KEYS = [
  'shutoff_location', 'power_at_intake', 'drain_at_intake', 'irrigation_lines',
  'removing_old_equipment',
]

// Already columns on the job. Listed so the checklist can show them and
// count them, and so the drawer knows which edit field fixes each.
export const JOB_FIELD_ITEMS = [
  { key: 'faucet_finish', label: 'Faucet finish' },
  { key: 'ro_type', label: 'RO type' },
  { key: 'payment_type', label: 'Payment type' },
]

const KEYS = CHECKLIST_ITEMS.map(i => i.key)

// What a form holds for the checklist: every value a string, because that is
// what an input holds. upcharge sits beside removing_old_equipment.
export function emptyChecklistForm() {
  const out = {}
  for (const key of KEYS) out[key] = ''
  out.old_equipment_upcharge = ''
  return out
}

function asCountString(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  return Number.isInteger(n) && n >= 0 ? String(n) : ''
}

function asChoice(value, allowed) {
  const v = String(value ?? '').trim().toLowerCase()
  return allowed.includes(v) ? v : ''
}

/**
 * A stored checklist as form strings.
 *
 * Anything the database holds that is not a recognisable answer comes back
 * blank rather than throwing, because this reads whatever is in the row, and
 * a blank shows amber, which is the truthful thing to show for a value nobody
 * can use.
 */
export function checklistToForm(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const form = emptyChecklistForm()

  for (const item of CHECKLIST_ITEMS) {
    const v = src[item.key]
    if (item.kind === 'count') form[item.key] = asCountString(v)
    else if (item.kind === 'text') form[item.key] = typeof v === 'string' ? v : ''
    else if (item.kind === 'yesno') form[item.key] = asChoice(v, [YES, NO])
    else form[item.key] = asChoice(v, [YES, NO, UNKNOWN])
  }

  const up = Number(src.old_equipment_upcharge)
  form.old_equipment_upcharge =
    src.old_equipment_upcharge === null || src.old_equipment_upcharge === undefined
    || src.old_equipment_upcharge === '' || !Number.isFinite(up) || up < 0
      ? ''
      : String(up)

  return form
}

/**
 * What is wrong with one item as typed, or an empty string.
 *
 * Blanks are never a problem here, see the note at the top of this file. Only
 * a value that is present and unusable is: a count that is not a whole number
 * of zero or more, or an upcharge that is negative or sits on anything but a
 * yes. The upcharge belongs to removing_old_equipment, so its problems are
 * reported against that item, which is the box the amber lands on.
 *
 * The screen calls this as the person types, so a bad value goes amber at
 * once; validateChecklist calls it on save. One rule and one sentence for
 * both, so what the box says and what the save refuses cannot drift apart.
 */
export function itemProblem(form, key) {
  const f = form || {}

  if (key === 'people_in_home' || key === 'bathrooms') {
    const raw = String(f[key] ?? '').trim()
    if (raw === '') return ''
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return ''
    const label = CHECKLIST_ITEMS.find(i => i.key === key).label
    return `${label} must be a whole number, zero or more.`
  }

  if (key === 'removing_old_equipment') {
    const up = String(f.old_equipment_upcharge ?? '').trim()
    if (up === '') return ''
    const n = Number(up)
    if (!Number.isFinite(n) || n < 0) return 'The old equipment upcharge must be zero or more.'
    if (f.removing_old_equipment !== YES) {
      return 'An upcharge is only for removing old equipment. Answer yes, or clear the amount.'
    }
  }

  return ''
}

/**
 * The first problem with what was typed, or an empty string. Checked in screen
 * order, so the message on save names the first amber box a person would see.
 */
export function validateChecklist(form) {
  for (const item of CHECKLIST_ITEMS) {
    const problem = itemProblem(form, item.key)
    if (problem) return problem
  }
  return ''
}

/**
 * Form strings as the object stored in jobs.sales_checklist.
 *
 * Blanks are left out rather than stored as empty strings or nulls, so an
 * unanswered item is simply absent and there is one way to be unanswered. The
 * upcharge is dropped unless old equipment is coming out, so a no cannot carry
 * a leftover amount into the work order.
 */
export function checklistFromForm(form) {
  const f = form || {}
  const out = {}

  for (const item of CHECKLIST_ITEMS) {
    const raw = String(f[item.key] ?? '').trim()
    if (raw === '') continue
    if (item.kind === 'count') {
      const n = Number(raw)
      if (Number.isInteger(n) && n >= 0) out[item.key] = n
    } else if (item.kind === 'text') {
      out[item.key] = raw
    } else {
      const allowed = item.kind === 'yesno' ? [YES, NO] : [YES, NO, UNKNOWN]
      const v = raw.toLowerCase()
      if (allowed.includes(v)) out[item.key] = v
    }
  }

  if (out.removing_old_equipment === YES) {
    const up = String(f.old_equipment_upcharge ?? '').trim()
    const n = Number(up)
    if (up !== '' && Number.isFinite(n) && n >= 0) out.old_equipment_upcharge = n
  }

  return out
}

export function isEmptyChecklist(stored) {
  return !stored || Object.keys(stored).length === 0
}

/**
 * Whether one checklist item is answered.
 *
 * Removing old equipment is only answered when a yes also says what the
 * upcharge is, because a yes with no amount is the exact gap that turns into
 * an argument on install day. A value itemProblem refuses is not answered
 * either.
 */
export function isAnswered(form, key) {
  const v = String(form?.[key] ?? '').trim()
  if (v === '') return false
  // An unusable value is not an answer. It will not be stored, so counting it
  // would say "All 3 answered" over a box holding 2.5 bathrooms.
  if (itemProblem(form, key)) return false
  if (key === 'removing_old_equipment' && v === YES) {
    return String(form?.old_equipment_upcharge ?? '').trim() !== ''
  }
  return true
}

/**
 * Every unanswered item, checklist and job fields together, in screen order.
 *
 * job supplies the three that are columns. Pass the form's values on the new
 * quote form and the job row in the drawer.
 */
export function unansweredItems(form, job) {
  const missing = CHECKLIST_ITEMS
    .filter(item => !isAnswered(form, item.key))
    .map(item => ({ key: item.key, label: item.label, onJob: false }))

  for (const item of JOB_FIELD_ITEMS) {
    if (String(job?.[item.key] ?? '').trim() === '') {
      missing.push({ key: item.key, label: item.label, onJob: true })
    }
  }

  return missing
}

export const CHECKLIST_TOTAL = CHECKLIST_ITEMS.length + JOB_FIELD_ITEMS.length

function money(n) {
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * The lines the work order adds to site conditions.
 *
 * Two of the checklist answers matter to the installer at the door: where the
 * shutoff is, and whether old equipment comes out and at what charge. The
 * rest decided the sale and the system, and are already reflected in what is
 * on the truck.
 *
 * Mirrored in supabase/functions/send-agreement/siteConditions.ts, which is
 * what actually prints. check:checklist loads both and asserts they agree.
 */
export function workOrderSiteLines(stored) {
  const s = stored && typeof stored === 'object' ? stored : {}
  const lines = []

  const shutoff = typeof s.shutoff_location === 'string' ? s.shutoff_location.trim() : ''
  if (shutoff) lines.push(`Main water shutoff: ${shutoff}`)

  if (s.removing_old_equipment === YES) {
    const up = Number(s.old_equipment_upcharge)
    lines.push(Number.isFinite(up) && s.old_equipment_upcharge !== undefined && s.old_equipment_upcharge !== null
      ? `Remove old equipment (upcharge ${money(up)})`
      : 'Remove old equipment (upcharge not recorded)')
  } else if (s.removing_old_equipment === NO) {
    lines.push('Old equipment stays')
  }

  return lines
}

/**
 * Site conditions as printed: what the office typed, then the checklist lines.
 * Empty when there is nothing at all, so the work order still locks the field
 * blank rather than printing a placeholder.
 */
export function workOrderSiteConditions(siteConditions, stored) {
  const typed = String(siteConditions ?? '').trim()
  return [typed, ...workOrderSiteLines(stored)].filter(Boolean).join('\n')
}
