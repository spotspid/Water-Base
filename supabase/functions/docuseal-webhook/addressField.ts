// Which box on a signed document is the install address.
//
// Its own file, with no Deno imports, so the repo check can import it under
// Node and hold it to the names the templates actually use. That matters more
// here than anywhere else in this function, because when this match fails
// nothing breaks loudly: the signature records, the document files, and the
// address the customer typed is quietly dropped.
//
// Which is what happened. The list was matched with Array.includes, an exact
// comparison, against names written with spaces, while send-agreement builds
// the box as install_address, with an underscore, because that is its name on
// the DocuSeal template. So the two never met.
//
// Jim Finney signed on 2026-10-23 with that box open and required in front of
// him, his job kept no address, and David spent the following afternoon unable
// to send the work order for want of the thing the customer had already been
// asked for.
//
// So the comparison is now what the old comment claimed it was: loose.
// Underscores, hyphens and repeated spaces all read as one space, case is
// ignored, and a trailing colon or asterisk from a label like "Install
// Address:*" is dropped.
export const ADDRESS_FIELDS = [
  'address',
  'install address',
  'installation address',
  'service address',
  'street address',
  'property address',
]

export function normaliseFieldName(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[:*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isAddressField(name: unknown): boolean {
  return ADDRESS_FIELDS.includes(normaliseFieldName(name))
}

/**
 * The address off a signed document, or '' when it carries none.
 *
 * Takes the list of field values DocuSeal returns. The first address box with
 * something in it wins: a template with both an address and a street address
 * box, filled once, should still answer.
 */
export function signedAddress(values: unknown): string {
  if (!Array.isArray(values)) return ''

  for (const entry of values) {
    const row = (entry ?? {}) as Record<string, unknown>
    if (!isAddressField(row.field)) continue
    const value = String(row.value ?? '').trim()
    if (value) return value
  }

  return ''
}
