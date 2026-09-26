import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { inline, parseMarkdown, titleOf } from '../src/lib/markdown.js'

// The Help section renders docs/ through this parser, so a guide that parses
// wrongly is a page that lies or a page that is blank. Every real guide is
// parsed here, and a line that reaches nothing would be a line the reader
// never sees.
//
// Run with: npm run check:markdown

let failed = 0

// Fixtures are written as arrays of lines joined by this, so a source file
// with its own line endings cannot be mistaken for one of them.
const NEWLINE = String.fromCharCode(10)

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- the pieces, one shape at a time ---------------------------------------

const blocks = parseMarkdown([
  '# Quotes',
  '',
  'A quote is a price **nobody** has agreed to.',
  'It carries on this line.',
  '',
  '## The list',
  '',
  '| Column | What it is |',
  '|---|---|',
  '| Price | The quoted price. |',
  '| Sent | When it went. |',
  '',
  '- one',
  '- two that wraps',
  '  onto the next line',
  '',
  '1. first',
  '2. second',
  '',
  '> A quote cannot have a scheduled date.',
  '> Mark it sold first.',
  '',
  'See [Jobs](jobs.md) and `npm run check`.',
].join('\n'))

const kinds = blocks.map(b => b.kind).join(',')
check('blocks come out in order', kinds === 'heading,para,heading,table,list,list,quote,para', kinds)
check('the heading keeps its level', blocks[0].level === 1 && blocks[2].level === 2)
check('the title is the first heading', titleOf(blocks) === 'Quotes')
check('a wrapped paragraph joins into one', blocks[1].text.endsWith('carries on this line.'))
check('the table head is read', blocks[3].head.join('|') === 'Column|What it is')
check('the table rows are read', blocks[3].rows.length === 2 && blocks[3].rows[1][0] === 'Sent')
check('a bullet list is unordered', blocks[4].ordered === false && blocks[4].items.length === 2)
check('a wrapped bullet keeps its text', blocks[4].items[1] === 'two that wraps onto the next line')
check('a numbered list is ordered', blocks[5].ordered === true && blocks[5].items.join('|') === 'first|second')
check('and starts where it says it does', blocks[5].start === 1, String(blocks[5].start))
check('a quote joins its lines', blocks[6].text === 'A quote cannot have a scheduled date. Mark it sold first.')

// --- lists whose items are paragraphs --------------------------------------
//
// Every numbered list in the guides puts a blank line between its items.
// Ending the list there turned each item into a list of one, and a list of
// one numbers itself 1, so the ten rough edges on the jobs page all read
// "1." Both on screen and in the printed book.

const loose = parseMarkdown([
  '1. **The first fault.** It carries on',
  '   across a wrapped line.',
  '',
  '2. **The second fault.**',
  '',
  '3. **The third fault.**',
].join(NEWLINE))

check('a numbered list survives the blank lines between its items',
  loose.length === 1 && loose[0].items.length === 3, `${loose.length} blocks`)
check('and keeps the wrapped line with its item',
  loose[0].items[0].endsWith('across a wrapped line.'), loose[0].items[0])

const looseBullets = parseMarkdown(['- one', '', '- two', '', 'A paragraph.'].join(NEWLINE))
check('a bullet list does the same', looseBullets[0].items.length === 2)
check('and a paragraph after it still ends it',
  looseBullets.length === 2 && looseBullets[1].kind === 'para', looseBullets.map(b => b.kind).join(','))

const pickup = parseMarkdown(['Something.', '', '3. three', '', '4. four'].join(NEWLINE))
check('a list that picks up at 3 says so', pickup[1].start === 3, String(pickup[1].start))

const separated = parseMarkdown(['- one', '', '## A heading', '', '- two'].join(NEWLINE))
check('a heading between two lists keeps them apart',
  separated.map(b => b.kind).join(',') === 'list,heading,list', separated.map(b => b.kind).join(','))

const pieces = inline('A **bold** word, `code`, and a [link](jobs.md).')
check('inline splits into pieces', pieces.map(p => p.kind).join(',') === 'text,strong,text,code,text,link,text',
  pieces.map(p => p.kind).join(','))
check('a link keeps its target', pieces.find(p => p.kind === 'link').href === 'jobs.md')
check('plain text with no markup is one piece', inline('nothing here').length === 1)
check('empty text is nothing at all', inline('').length === 0)

// --- every real guide ------------------------------------------------------

const docsDir = resolve(import.meta.dirname, '..', 'docs')
const files = readdirSync(docsDir).filter(name => name.endsWith('.md'))

check('there are guides to render', files.length > 0, files.join(', '))

for (const file of files) {
  const source = readFileSync(resolve(docsDir, file), 'utf8')
  const parsed = parseMarkdown(source)

  // A rough edges section is one numbered list. Ten lists of one item each
  // is the bug that made every entry read "1."
  const singles = parsed.filter(b => b.kind === 'list' && b.ordered && b.items.length === 1)
  check(`${file} has no numbered list of one item`, singles.length === 0,
    singles.map(b => b.items[0].slice(0, 30)).join(' / '))
  const lines = source.split(/\r?\n/).filter(line => line.trim() !== '').length

  check(`${file} parses into blocks`, parsed.length > 0, `${parsed.length} blocks`)
  check(`${file} has a title`, titleOf(parsed) !== '')

  // Nothing is dropped: every non blank line ends up inside some block.
  const carried = parsed.reduce((sum, block) => {
    if (block.kind === 'table') return sum + 1 + block.rows.length
    if (block.kind === 'list') return sum + block.items.length
    return sum + 1
  }, 0)

  check(`${file} keeps every line`, carried > 0 && carried <= lines,
    `${carried} blocks worth of ${lines} lines`)

  // A heading with no text, or a table row with more cells than headings,
  // would render as a hole in the page.
  const badHeading = parsed.find(b => b.kind === 'heading' && b.text === '')
  check(`${file} has no empty heading`, !badHeading)

  const badRow = parsed.find(b => b.kind === 'table' && b.rows.some(r => r.length !== b.head.length))
  check(`${file} tables are square`, !badRow, badRow ? JSON.stringify(badRow.head) : '')
}

console.log(failed === 0
  ? '\nAll markdown checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
