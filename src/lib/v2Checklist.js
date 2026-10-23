// The questions a quote asks, rebuilt.
//
// Its own list rather than the live one, because the live one belongs to the
// live app and changing it there is the thing the partition exists to stop.
// Same idea, three differences, all from watching somebody use it:
//
//   Drain distance was a number you typed every single time. It is now a yes
//   or no with a note when the answer is no. Nobody measures a drain on a
//   sales call; they look at it and think "that's fine" or "that's a problem",
//   and only the second one is worth writing down.
//
//   That change moves it into the checks, so All clear covers it. A section
//   button is only as useful as the number of questions it can honestly
//   answer, and this takes that from four to five.
//
//   Sizing gets a button too. Most homes are two people and two bathrooms,
//   and typing that on every quote is the same waste. It fills them in and
//   they stay editable, because it is a default rather than an answer.
//
// A note appears only when a check comes back no. Somebody who looks at a
// receptacle and sees a receptacle has nothing to write.

export const YES = 'yes'
export const NO = 'no'
export const NOT_SURE = 'not_sure'
export const NOT_SURE_LABEL = 'Not sure yet'

export const LINE_SIZES = [
  ['half', '1/2 inch'],
  ['three_quarter', '3/4 inch'],
  ['one', '1 inch'],
]

export const LINE_MATERIALS = [
  ['pex', 'PEX'],
  ['cpvc', 'CPVC'],
  ['pvc', 'PVC'],
  ['copper', 'Copper'],
  ['galvanized', 'Galvanized'],
]

export const ITEMS = [
  { key: 'people_in_home', label: 'People in the home', kind: 'count' },
  { key: 'bathrooms', label: 'Bathrooms', kind: 'count' },

  { key: 'space_confirmed', label: 'Room for the unit', kind: 'yesno' },
  { key: 'receptacle_within_6ft', label: 'Receptacle within 6 feet', kind: 'yesno' },
  { key: 'drain_in_reach', label: 'Drain within reach', kind: 'yesno' },
  { key: 'irrigation_lines', label: 'Irrigation lines', kind: 'yesno' },
  { key: 'removing_old_equipment', label: 'Taking the old equipment', kind: 'yesno' },

  { key: 'shutoff_location', label: 'Main water shutoff', kind: 'text',
    placeholder: 'Basement by the water heater, garage, crawlspace' },
  { key: 'main_line_size', label: 'Main line size', kind: 'choice', options: LINE_SIZES },
  { key: 'main_line_material', label: 'Main line material', kind: 'choice', options: LINE_MATERIALS },
]

export const SECTIONS = [
  {
    id: 'sizing',
    title: 'Sizing',
    note: 'Decides which system to quote.',
    keys: ['people_in_home', 'bathrooms'],
    bulk: 'typical',
    bulkLabel: 'Typical home',
  },
  {
    id: 'checks',
    title: 'Quick checks',
    note: 'Things you answer by looking. Say so only when one is a problem.',
    keys: ['space_confirmed', 'receptacle_within_6ft', 'drain_in_reach',
      'irrigation_lines', 'removing_old_equipment'],
    bulk: 'yes',
    bulkLabel: 'All clear',
  },
  {
    id: 'plumbing',
    title: 'Plumbing',
    note: 'What the installer needs to plan the job.',
    keys: ['shutoff_location', 'main_line_size', 'main_line_material'],
    bulk: 'not_sure',
    bulkLabel: 'Not sure yet on the rest',
  },
]

// What Typical home fills in. A default, not an answer: both stay editable and
// neither is remembered as having been confirmed by anybody.
export const TYPICAL = { people_in_home: '2', bathrooms: '2' }

export function itemFor(key) {
  return ITEMS.find(item => item.key === key) || null
}

export function emptyChecklist() {
  const form = {}

  for (const item of ITEMS) {
    form[item.key] = ''
    if (item.kind === 'yesno') form[`${item.key}_note`] = ''
  }

  return form
}

export function isAnswered(form, key) {
  return String(form?.[key] ?? '').trim() !== ''
}

export function isNotSure(form, key) {
  return String(form?.[key] ?? '') === NOT_SURE
}

// A note belongs to a check that came back no. Yes means there was nothing to
// say, and keeping a note written before somebody changed their mind would
// leave the document contradicting the answer above it.
export function noteApplies(form, key) {
  const item = itemFor(key)
  return item?.kind === 'yesno' && String(form?.[key] ?? '') === NO
}

export function answer(form, key, value) {
  const next = { ...form, [key]: value }

  if (itemFor(key)?.kind === 'yesno' && value !== NO) next[`${key}_note`] = ''

  return next
}

export function countAnswered(form, keys) {
  return keys.filter(key => isAnswered(form, key)).length
}

/**
 * What a section's button does, applied only to what is still blank.
 *
 * Never overwrites an answer somebody gave. Pressing All clear after saying no
 * to one thing should not quietly turn it into a yes.
 */
export function applyBulk(form, section) {
  const next = { ...form }

  for (const key of section.keys) {
    if (isAnswered(form, key)) continue

    if (section.bulk === 'yes') next[key] = YES
    else if (section.bulk === 'not_sure') next[key] = NOT_SURE
    else if (section.bulk === 'typical' && TYPICAL[key]) next[key] = TYPICAL[key]
  }

  return next
}

// What gets stored on the job: answers only, no blanks, and no note belonging
// to a question that is not a no any more.
export function toStored(form) {
  const stored = {}

  for (const item of ITEMS) {
    if (!isAnswered(form, item.key)) continue

    stored[item.key] = form[item.key]

    const note = String(form[`${item.key}_note`] ?? '').trim()
    if (noteApplies(form, item.key) && note) stored[`${item.key}_note`] = note
  }

  return stored
}
