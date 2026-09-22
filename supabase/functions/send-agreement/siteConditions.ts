// Site conditions as the work order prints them.
//
// What the office typed on the job, then four lines from the sales checklist
// the installer needs at the door: where the main shutoff is, whether old
// equipment comes out and at what charge, how far the drain run is, and what
// the main line is made of.
//
// This is a copy of workOrderSiteLines and workOrderSiteConditions in
// src/lib/salesChecklist.js. The function is deployed from this directory
// alone, so it cannot import from src. npm run check:checklist loads both and
// asserts they produce the same text for the same input, which is what stops
// the screen and the printed page drifting apart.
//
// Type annotations only, nothing Node cannot strip, so that check can load it.

type Checklist = {
  shutoff_location?: unknown
  removing_old_equipment?: unknown
  old_equipment_upcharge?: unknown
  drain_distance_ft?: unknown
  main_line_material?: unknown
}

// A copy of LINE_MATERIALS in src/lib/salesChecklist.js, for the same reason
// this whole file is a copy. check:checklist compares the output of both, so a
// material added there and forgotten here fails the check rather than printing
// a blank line on a work order.
const MATERIAL_LABELS: Record<string, string> = {
  pex: 'PEX',
  cpvc: 'CPVC',
  pvc: 'PVC',
  copper: 'Copper',
  galvanized: 'Galvanized',
}

// The stored value for "Not sure yet", as src/lib/salesChecklist.js calls it.
//
// A job with any answer still Not sure yet cannot be given a date, a crew or
// an install (the jobs_guard_unsure trigger), so it never reaches a work
// order. There is no wording for it here for that reason. It is still named,
// so that if one ever did arrive it prints nothing rather than the raw word.
const NOT_SURE = 'not_sure'

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function workOrderSiteLines(stored: unknown): string[] {
  const s: Checklist = stored && typeof stored === 'object' ? stored as Checklist : {}
  const lines: string[] = []

  const shutoff = typeof s.shutoff_location === 'string' ? s.shutoff_location.trim() : ''
  if (shutoff && shutoff !== NOT_SURE) lines.push(`Main water shutoff: ${shutoff}`)

  if (s.removing_old_equipment === 'yes') {
    const up = Number(s.old_equipment_upcharge)
    lines.push(Number.isFinite(up) && s.old_equipment_upcharge !== undefined && s.old_equipment_upcharge !== null
      ? `Remove old equipment (upcharge ${money(up)})`
      : 'Remove old equipment (upcharge not recorded)')
  } else if (s.removing_old_equipment === 'no') {
    lines.push('Old equipment stays')
  }

  const drain = Number(s.drain_distance_ft)
  if (s.drain_distance_ft !== undefined && s.drain_distance_ft !== null
    && s.drain_distance_ft !== '' && Number.isInteger(drain) && drain >= 0) {
    lines.push(`Drain run: ${drain} ft`)
  }

  const material = MATERIAL_LABELS[String(s.main_line_material ?? '')]
  if (material) lines.push(`Main water line: ${material}`)

  return lines
}

export function workOrderSiteConditions(siteConditions: unknown, stored: unknown): string {
  const typed = String(siteConditions ?? '').trim()
  return [typed, ...workOrderSiteLines(stored)].filter(Boolean).join('\n')
}
