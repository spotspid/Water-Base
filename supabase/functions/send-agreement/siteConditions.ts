// Site conditions as the work order prints them.
//
// What the office typed on the job, then two lines from the sales checklist
// the installer needs at the door: where the main shutoff is, and whether old
// equipment comes out and at what charge.
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
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function workOrderSiteLines(stored: unknown): string[] {
  const s: Checklist = stored && typeof stored === 'object' ? stored as Checklist : {}
  const lines: string[] = []

  const shutoff = typeof s.shutoff_location === 'string' ? s.shutoff_location.trim() : ''
  if (shutoff) lines.push(`Main water shutoff: ${shutoff}`)

  if (s.removing_old_equipment === 'yes') {
    const up = Number(s.old_equipment_upcharge)
    lines.push(Number.isFinite(up) && s.old_equipment_upcharge !== undefined && s.old_equipment_upcharge !== null
      ? `Remove old equipment (upcharge ${money(up)})`
      : 'Remove old equipment (upcharge not recorded)')
  } else if (s.removing_old_equipment === 'no') {
    lines.push('Old equipment stays')
  }

  return lines
}

export function workOrderSiteConditions(siteConditions: unknown, stored: unknown): string {
  const typed = String(siteConditions ?? '').trim()
  return [typed, ...workOrderSiteLines(stored)].filter(Boolean).join('\n')
}
