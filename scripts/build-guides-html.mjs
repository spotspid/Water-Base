// The guides in docs/, laid out as one printable book.
//
// This writes the HTML. scripts/build-guides-pdf.py prints it through
// Chromium and stitches the result together, because the page numbers in the
// contents can only be known once the thing has been paginated.
//
// The Markdown is parsed by src/lib/markdown.js, the same parser the Help
// section renders with. One parser of record: a guide that reads correctly in
// the app cannot read differently on paper.
//
// Run through: npm run docs:pdf
//
// Usage: node scripts/build-guides-html.mjs <out.html> [toc-pages.json]

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMarkdown, inline, titleOf } from '../src/lib/markdown.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

// The order they are read in, which is the order the index lists them. The
// index comes first because it says what the rest are for.
const SECTIONS = ['README', 'new-job', 'quotes', 'jobs', 'inventory', 'documents', 'schedule']

const outPath = process.argv[2]
const pagesPath = process.argv[3]

if (!outPath) {
  console.error('Usage: node scripts/build-guides-html.mjs <out.html> [toc-pages.json]')
  process.exit(1)
}

// Page numbers from a first pass, keyed by anchor id. Missing on the first
// pass, which is the point: the contents is laid out either way so that
// filling the numbers in cannot change the pagination.
const pageFor = pagesPath && existsSync(pagesPath)
  ? JSON.parse(readFileSync(pagesPath, 'utf8'))
  : {}

const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

function dataUri(relPath, mime) {
  const bytes = readFileSync(resolve(root, relPath))
  return `data:${mime};base64,${bytes.toString('base64')}`
}

// Every anchor this book contains, so a link to a file that was not printed
// can be told apart from one that was.
const PRINTED = new Set(SECTIONS.map(
  name => `section-${slug(name === 'README' ? 'readme' : name)}`,
))

// A link in the guides points at another guide's file. On paper that is a
// jump within this document, so quotes.md becomes the anchor the section was
// printed under, and README.md becomes the overview. A link to a file that is
// not in this book, such as the list of known issues, returns null and is
// printed as plain words: a dead link on paper is worse than no link.
function hrefFor(target) {
  const clean = String(target || '').trim()
  if (/^https?:/i.test(clean)) return clean
  const file = clean.replace(/\.md$/i, '')
  if (!file) return null
  const id = file === 'README' ? 'section-readme' : `section-${slug(file)}`
  return PRINTED.has(id) ? `#${id}` : null
}

function renderInline(text) {
  return inline(text).map(piece => {
    if (piece.kind === 'strong') return `<strong>${escapeHtml(piece.text)}</strong>`
    if (piece.kind === 'code') return `<code>${escapeHtml(piece.text)}</code>`
    if (piece.kind === 'link') {
      const href = hrefFor(piece.href)
      return href
        ? `<a href="${escapeHtml(href)}">${escapeHtml(piece.text)}</a>`
        : escapeHtml(piece.text)
    }
    return escapeHtml(piece.text)
  }).join('')
}

/**
 * One guide as HTML, and the headings it contributes to the contents.
 *
 * The file's own H1 becomes the section title in the running header, so the
 * body starts at the first thing under it rather than repeating the name.
 */
function renderSection(name, source) {
  const blocks = parseMarkdown(source)
  const title = titleOf(blocks) || name
  const id = `section-${slug(name === 'README' ? 'readme' : name)}`
  const entries = []
  const html = []
  let seenTitle = false

  for (const block of blocks) {
    if (block.kind === 'heading') {
      if (!seenTitle && block.level === 1) { seenTitle = true; continue }

      const headingId = `${id}-${slug(block.text)}`
      const level = Math.min(block.level, 4)
      if (level === 2) entries.push({ id: headingId, text: block.text })
      html.push(`<h${level} id="${headingId}">${renderInline(block.text)}</h${level}>`)
      continue
    }

    if (block.kind === 'para') {
      html.push(`<p>${renderInline(block.text)}</p>`)
      continue
    }

    if (block.kind === 'quote') {
      html.push(`<blockquote>${renderInline(block.text)}</blockquote>`)
      continue
    }

    if (block.kind === 'list') {
      const items = block.items.map(item => `<li>${renderInline(item)}</li>`).join('')
      // start is the number the list was written from, so a list picking up
      // at 3 prints 3.
      html.push(block.ordered
        ? `<ol start="${block.start || 1}">${items}</ol>`
        : `<ul>${items}</ul>`)
      continue
    }

    if (block.kind === 'table') {
      const head = block.head.map(cell => `<th>${renderInline(cell)}</th>`).join('')
      const rows = block.rows
        .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')
      html.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`)
    }
  }

  return { id, title, entries, body: html.join('\n') }
}

const sections = SECTIONS.map(name => {
  const source = readFileSync(resolve(root, 'docs', `${name}.md`), 'utf8')
  return renderSection(name, source)
})

// --- the contents ----------------------------------------------------------

function pageOf(id) {
  const page = pageFor[id]
  return page ? String(page) : '&nbsp;'
}

function tocEntry(section) {
  const subs = section.entries.map(entry => `
        <li class="toc-sub">
          <a href="#${entry.id}"><span class="toc-text">${escapeHtml(entry.text)}</span>
          <span class="toc-dots"></span>
          <span class="toc-page">${pageOf(entry.id)}</span></a>
        </li>`).join('')

  return `
      <li class="toc-section">
        <a href="#${section.id}"><span class="toc-text">${escapeHtml(section.title)}</span>
        <span class="toc-dots"></span>
        <span class="toc-page">${pageOf(section.id)}</span></a>
        <ul>${subs}</ul>
      </li>`
}

// Split into two columns of about the same depth, counting a section heading
// and each of its subheadings as one line. CSS columns fill greedily, which
// stranded the last guide on a page of its own while the first column still
// had a third of its height free.
const lines = section => 1 + section.entries.length
const total = sections.reduce((sum, section) => sum + lines(section), 0)

// The split that leaves the two columns closest in depth. Filling the first
// column until it passes halfway overshoots by a whole guide, which is how
// the first column ended up twice the height of the second and the contents
// spilled onto a third page.
let best = { at: 1, gap: Infinity }
let running = 0

for (let at = 1; at < sections.length; at++) {
  running += lines(sections[at - 1])
  const gap = Math.abs(running - (total - running))
  if (gap < best.gap) best = { at, gap }
}

const left = sections.slice(0, best.at)
const right = sections.slice(best.at)

const contents = [left, right]
  .map(column => `<ul class="toc-column">${column.map(tocEntry).join('')}</ul>`)
  .join('')

// --- the cover -------------------------------------------------------------

const emblem = dataUri('src/assets/emblem.png', 'image/png')
const wordmark = dataUri('src/assets/wordmark.png', 'image/png')

const today = new Date().toLocaleDateString('en-US', {
  month: 'long', day: 'numeric', year: 'numeric',
})

const coverList = sections.slice(1)
  .map(section => `<li>${escapeHtml(section.title)}</li>`).join('')

// --- the page --------------------------------------------------------------
//
// The colours are the app's own tokens from src/index.css, copied rather than
// imported because this file is printed on its own and a stylesheet built for
// a screen brings a layout with it.

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Water Base, page by page</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet">
<style>
:root {
  --navy: #1C3651;
  --navy-900: #132538;
  --teal: #2C819B;
  --teal-deep: #1D6580;
  --teal-soft: #E4F0F4;
  --maroon: #8C2F2F;
  --ink: #14202C;
  --body-text: #3E4E5C;
  --muted: #7A8B99;
  --line: #E2E8EE;
  --line-soft: #EDF1F5;
  --paper: #F5F7F9;
  --raised: #FBFCFD;
}

@page { size: Letter; margin: 19mm 17mm 17mm; }
@page :first { margin: 0; }

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: Inter, 'Segoe UI', system-ui, sans-serif;
  font-size: 10.2pt;
  line-height: 1.55;
  color: var(--body-text);
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

h1, h2, h3, h4 { font-family: Poppins, 'Segoe UI Semibold', system-ui, sans-serif; color: var(--navy); }

/* --- cover --------------------------------------------------------------- */

.cover {
  page-break-after: always;
  height: 279.4mm;
  display: flex;
  flex-direction: column;
}

.cover-band {
  background: var(--navy);
  color: #C6D8E4;
  padding: 14mm 17mm 12mm;
  display: flex;
  align-items: center;
  gap: 10px;
}

.cover-band img { width: 34px; height: 34px; }

.cover-band span {
  font-family: Poppins, system-ui, sans-serif;
  font-size: 10pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.cover-main {
  flex: 1;
  padding: 0 17mm;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.cover-main img.wordmark { width: 86mm; display: block; }

.cover-rule { height: 3px; width: 28mm; background: var(--teal); margin: 9mm 0 7mm; }

.cover h1 {
  font-size: 30pt;
  line-height: 1.15;
  margin: 0 0 4mm;
  letter-spacing: -0.01em;
}

.cover-sub { font-size: 12pt; color: var(--body-text); margin: 0 0 12mm; max-width: 120mm; }

.cover-what {
  font-family: Poppins, system-ui, sans-serif;
  font-size: 8.5pt;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 3mm;
}

.cover ul.cover-list {
  margin: 0;
  padding: 0;
  list-style: none;
  max-width: 120mm;
  font-size: 10.5pt;
  color: var(--navy);
}

.cover ul.cover-list li { padding: 1.3mm 0; margin: 0; }

.cover ul.cover-list li::before {
  content: '';
  display: inline-block;
  width: 5px; height: 5px;
  border-radius: 50%;
  background: var(--teal);
  margin-right: 7px;
  vertical-align: middle;
}

.cover-foot {
  padding: 0 17mm 16mm;
  color: var(--muted);
  font-size: 9pt;
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  margin: 0 17mm;
  padding: 5mm 0 16mm;
}

/* --- contents ------------------------------------------------------------ */

.toc { page-break-after: always; }

.toc h1 { font-size: 18pt; margin: 0 0 1.5mm; }

.toc-note { color: var(--muted); font-size: 9pt; margin: 0 0 4mm; }

/* Two columns, so the contents is one page a reader can hold the whole book
   in rather than three they have to page through. Split in the builder, not
   by the column filler, which leaves one of them short. */
/* Inline blocks rather than flex: Chromium fragments a flex row badly in
   print and pushed the second column onto a page of its own. */
.toc-columns { font-size: 0; }

.toc-columns > ul {
  display: inline-block;
  vertical-align: top;
  width: 48%;
  font-size: 10pt;
}

.toc-columns > ul + ul { margin-left: 4%; }

.toc ul { list-style: none; margin: 0; padding: 0; }

/* The body rule puts 1.6mm under every list item, which over sixty contents
   entries is half a page of air and was enough to push the whole thing onto
   a page of its own. */
.toc li { margin: 0; }

.toc-section > a {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-family: Poppins, system-ui, sans-serif;
  font-size: 10.5pt;
  color: var(--navy);
  text-decoration: none;
  padding: 0 0 1mm;
  border-bottom: 1px solid var(--line-soft);
}

.toc-section + .toc-section { margin-top: 3.2mm; }

.toc-sub > a {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 8.8pt;
  color: var(--body-text);
  text-decoration: none;
  padding: 0.45mm 0 0.45mm 4mm;
}

.toc-section { page-break-inside: avoid; }

.toc-dots {
  flex: 1;
  border-bottom: 1px dotted var(--line);
  transform: translateY(-3px);
}

.toc-page { font-variant-numeric: tabular-nums; color: var(--teal-deep); font-weight: 600; }

.toc-sub .toc-page { color: var(--muted); font-weight: 500; }

/* --- sections ------------------------------------------------------------ */

.section { page-break-before: always; }

.section-head {
  border-bottom: 2px solid var(--teal);
  padding-bottom: 3mm;
  margin-bottom: 6mm;
}

.section-kicker {
  font-family: Poppins, system-ui, sans-serif;
  font-size: 8pt;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--teal-deep);
  margin: 0 0 1.5mm;
}

.section-head h1 { font-size: 22pt; margin: 0; }

h2 {
  font-size: 13pt;
  margin: 7mm 0 2.5mm;
  padding-top: 1mm;
  border-top: 1px solid var(--line-soft);
  page-break-after: avoid;
}

.section-head + h2 { border-top: 0; margin-top: 0; }

h3 { font-size: 11pt; margin: 5mm 0 2mm; page-break-after: avoid; }

p { margin: 0 0 3mm; }

strong { color: var(--ink); font-weight: 600; }

a { color: var(--teal-deep); text-decoration: none; }

code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 8.8pt;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.3mm 1.4mm;
  color: var(--navy);
}

ul, ol { margin: 0 0 3.5mm; padding-left: 5.5mm; }

li { margin: 0 0 1.6mm; }

li::marker { color: var(--teal); }

blockquote {
  margin: 0 0 3.5mm;
  padding: 2.5mm 4mm;
  background: var(--teal-soft);
  border-left: 3px solid var(--teal);
  border-radius: 0 6px 6px 0;
  color: var(--navy);
  page-break-inside: avoid;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 4mm;
  font-size: 9.2pt;
  page-break-inside: avoid;
}

thead th {
  background: var(--navy);
  color: #fff;
  font-family: Poppins, system-ui, sans-serif;
  font-weight: 600;
  text-align: left;
  padding: 2mm 2.6mm;
  font-size: 8.6pt;
  letter-spacing: 0.02em;
}

tbody td {
  border-bottom: 1px solid var(--line);
  padding: 2mm 2.6mm;
  vertical-align: top;
}

tbody tr:nth-child(even) td { background: var(--raised); }

tbody tr:last-child td { border-bottom: 1px solid var(--line); }
</style>
</head>
<body>

<section class="cover">
  <div class="cover-band">
    <img src="${emblem}" alt="">
    <span>Michigan Water Pros</span>
  </div>

  <div class="cover-main">
    <img class="wordmark" src="${wordmark}" alt="Water Base">
    <div class="cover-rule"></div>
    <h1>Page by page</h1>
    <p class="cover-sub">
      Plain guides to what each page does, what it refuses to do and why, and what
      happens after you press the button. Written for the people running the business,
      not for developers.
    </p>
    <p class="cover-what">What is inside</p>
    <ul class="cover-list">${coverList}</ul>
  </div>

  <div class="cover-foot">
    <span>Walked through against the live app</span>
    <span>${today}</span>
  </div>
</section>

<section class="toc">
  <h1>Contents</h1>
  <p class="toc-note">
    Every message quoted in these guides is the wording on screen, so it can be
    searched for word for word.
  </p>
  <div class="toc-columns">${contents}</div>
</section>

${sections.map(section => `
<section class="section" id="${section.id}">
  <div class="section-head">
    <p class="section-kicker">${section.id === 'section-readme' ? 'Overview' : 'Guide'}</p>
    <h1>${escapeHtml(section.title)}</h1>
  </div>
  ${section.body}
</section>`).join('\n')}

</body>
</html>
`

writeFileSync(outPath, html, 'utf8')

// The ids the contents needs page numbers for, in printing order, so the
// second pass knows what to look up.
const wanted = sections.flatMap(section => [
  { id: section.id, title: section.title },
  ...section.entries.map(entry => ({ id: entry.id, title: entry.text })),
])

console.log(JSON.stringify({ out: outPath, sections: sections.length, anchors: wanted.length }))
