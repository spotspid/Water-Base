// English helpers for sentences the app builds from a label rather than
// writing out longhand.
//
// The settings page drives six editable lists from one component, so its
// placeholder and its error message are assembled from the list title. That is
// worth keeping, because a seventh list should not need a seventh hardcoded
// sentence. It only works if the assembly is actually correct, which means
// singularising properly and choosing the article by sound.

// Plurals that no rule gets right. Deliberately short: a general inflector
// would be a lot of machinery to be wrong in new ways, and this app has a
// small, known vocabulary.
const IRREGULAR = {
  people: 'person',
  children: 'child',
  addresses: 'address',
  statuses: 'status',
  // Singulars that already end in "ie". Nothing in the suffix separates
  // "movies" from "cities", so the ones that break the rule are listed rather
  // than guessed at.
  movies: 'movie',
  cookies: 'cookie',
  calories: 'calorie',
  // same in both numbers
  series: 'series',
  species: 'species',
}

// Vowel letters that open with a consonant sound, so they take "a" not "an".
// A leading "u" is the common one: a unit, a user, a uniform.
const CONSONANT_SOUNDED = /^(?:u(?:n[aeiou]|s|t|ni)|eu|one\b|once\b)/i

// Consonants that open with a vowel sound, so they take "an".
// Silent h is the case that turns up in ordinary business writing.
const VOWEL_SOUNDED = /^(?:hour|honest|honou?r|heir)/i

/**
 * Singularises the last word of a phrase, leaving any qualifier in front of it
 * alone. "inventory categories" becomes "inventory category", not
 * "inventory categorie" and not "inventories category".
 */
export function singularise(phrase) {
  const text = String(phrase ?? '').trim()
  if (!text) return ''

  const parts = text.split(/\s+/)
  const last = parts[parts.length - 1]
  parts[parts.length - 1] = singulariseWord(last)
  return parts.join(' ')
}

function singulariseWord(word) {
  const lower = word.toLowerCase()

  if (IRREGULAR[lower]) return matchCase(word, IRREGULAR[lower])

  // already singular
  if (!lower.endsWith('s')) return word

  // words that are singular and simply end in double s: address, glass, gas
  if (lower.endsWith('ss')) return word

  // categories to category, cities to city. A singular that already ends in
  // "ie" looks identical here, so those live in IRREGULAR above and are
  // caught before this line runs.
  if (/[^aeiou]ies$/i.test(lower)) return word.slice(0, -3) + matchCase(word.slice(-1), 'y')

  // finishes to finish, boxes to box, batches to batch
  if (/(?:ss|x|z|ch|sh)es$/i.test(lower)) return word.slice(0, -2)

  // types to type, windows to window
  return word.slice(0, -1)
}

// Keeps the replacement in the same case as the text it replaces, so a title
// cased label does not come back with a stray lower case letter.
function matchCase(sample, replacement) {
  return /^[A-Z]/.test(sample)
    ? replacement.charAt(0).toUpperCase() + replacement.slice(1)
    : replacement
}

/**
 * "a" or "an", chosen by how the phrase sounds rather than by its first
 * letter. "an inventory category", but "a unit" and "an hour".
 */
export function indefiniteArticle(phrase) {
  const text = String(phrase ?? '').trim()
  if (!text) return 'a'

  if (VOWEL_SOUNDED.test(text)) return 'an'
  if (CONSONANT_SOUNDED.test(text)) return 'a'

  return /^[aeiou]/i.test(text) ? 'an' : 'a'
}

/**
 * The phrase with its article attached, ready to drop into a sentence.
 */
export function withArticle(phrase) {
  const text = String(phrase ?? '').trim()
  if (!text) return ''
  return `${indefiniteArticle(text)} ${text}`
}
