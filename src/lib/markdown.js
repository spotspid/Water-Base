// Just enough Markdown to render the guides in docs/.
//
// Not a general Markdown library and not trying to be. It reads exactly what
// those files contain: headings, paragraphs, bullet and numbered lists,
// tables, block quotes, and inline bold, code and links. Anything it does not
// recognise is shown as a paragraph rather than swallowed, because a guide
// with a line missing is worse than a guide with a plain line in it.
//
// Pure: text in, a list of blocks out, no React and no DOM. The page turns
// blocks into elements, and scripts/check-markdown.js holds this to the shapes
// the real files use.

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*]\s+(.*)$/
const NUMBER = /^\s*(\d+)\.\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const TABLE_DIVIDER = /^\s*\|?[\s:|-]+\|[\s:|-]*$/

function cells(line) {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
}

function isTableRow(line) {
  return line.trim().startsWith('|') && line.includes('|', 1)
}

/**
 * Inline text as a list of pieces.
 *
 *   text    plain words
 *   strong  **bold**
 *   code    `code`
 *   link    [words](target)
 *
 * Bold and code do not nest here, because nothing in the guides nests them.
 */
export function inline(text) {
  const pieces = []
  let rest = String(text ?? '')

  const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/

  while (rest) {
    const found = pattern.exec(rest)

    if (!found) {
      pieces.push({ kind: 'text', text: rest })
      break
    }

    if (found.index > 0) pieces.push({ kind: 'text', text: rest.slice(0, found.index) })

    if (found[1]) pieces.push({ kind: 'strong', text: found[2] })
    else if (found[3]) pieces.push({ kind: 'code', text: found[4] })
    else pieces.push({ kind: 'link', text: found[6], href: found[7] })

    rest = rest.slice(found.index + found[0].length)
  }

  return pieces.filter(piece => piece.kind !== 'text' || piece.text !== '')
}

/**
 * A guide as blocks.
 *
 *   heading  { level, text }
 *   para     { text }
 *   list     { ordered, items: [text] }
 *   table    { head: [cell], rows: [[cell]] }
 *   quote    { text }
 */
export function parseMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let paragraph = []

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'para', text: paragraph.join(' ') })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim() === '') { flush(); continue }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }

    // a table is a row, a divider, then rows until something else
    if (isTableRow(line) && isTableRow(lines[i + 1] || '') && TABLE_DIVIDER.test(lines[i + 1])) {
      flush()
      const head = cells(line)
      const rows = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(cells(lines[i]))
        i++
      }
      i--
      blocks.push({ kind: 'table', head, rows })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flush()
      const parts = [quote[1]]
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        parts.push(QUOTE.exec(lines[++i])[1])
      }
      blocks.push({ kind: 'quote', text: parts.join(' ').trim() })
      continue
    }

    const bullet = BULLET.exec(line)
    const numbered = NUMBER.exec(line)

    if (bullet || numbered) {
      flush()
      const ordered = Boolean(numbered)
      const items = []
      let current = (bullet ? bullet[1] : numbered[2]).trim()

      while (i + 1 < lines.length) {
        const next = lines[i + 1]
        const nextBullet = BULLET.exec(next)
        const nextNumber = NUMBER.exec(next)

        // a new item of the same kind
        if ((ordered && nextNumber) || (!ordered && nextBullet && !nextNumber)) {
          items.push(current)
          current = (ordered ? nextNumber[2] : nextBullet[1]).trim()
          i++
          continue
        }

        // an indented continuation of this item
        if (next.startsWith('  ') && next.trim() !== '' && !nextBullet && !nextNumber) {
          current = `${current} ${next.trim()}`
          i++
          continue
        }

        break
      }

      items.push(current)
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    paragraph.push(line.trim())
  }

  flush()
  return blocks
}

// The title is the first heading, so a page can name itself.
export function titleOf(blocks) {
  const first = (blocks || []).find(block => block.kind === 'heading')
  return first ? first.text : ''
}
