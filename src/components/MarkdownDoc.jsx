import { Link } from 'react-router-dom'
import { inline } from '../lib/markdown'

// A parsed guide, as elements.
//
// No styling of its own. Headings, paragraphs, lists and links are styled
// globally, and tables borrow the classes the rest of the app already uses, so
// a guide looks like the pages it describes rather than like a README.
//
// A link between guides is written as jobs.md in the file, because the files
// are read on their own in the repo as well as here. On screen those become
// routes; anything else is left as it was written.
function hrefFor(target) {
  const link = String(target || '')
  if (/^https?:\/\//i.test(link) || link.startsWith('/')) return link
  if (link.endsWith('.md')) {
    const slug = link.replace(/\.md$/, '')
    return slug.toLowerCase() === 'readme' ? '/help' : `/help/${slug}`
  }
  return link
}

function Inline({ text }) {
  return (
    <>
      {inline(text).map((piece, i) => {
        if (piece.kind === 'strong') return <strong key={i}>{piece.text}</strong>
        if (piece.kind === 'code') return <code key={i}>{piece.text}</code>

        if (piece.kind === 'link') {
          const href = hrefFor(piece.href)
          return href.startsWith('/')
            ? <Link key={i} to={href} className="tpl-link">{piece.text}</Link>
            : <a key={i} href={href} className="tpl-link" target="_blank" rel="noopener noreferrer">{piece.text}</a>
        }

        return <span key={i}>{piece.text}</span>
      })}
    </>
  )
}

export default function MarkdownDoc({ blocks, skipTitle = false }) {
  const shown = skipTitle
    ? (blocks || []).filter((block, i) => !(i === 0 && block.kind === 'heading' && block.level === 1))
    : (blocks || [])

  return (
    <div>
      {shown.map((block, i) => {
        if (block.kind === 'heading') {
          const Tag = `h${Math.min(block.level + 1, 6)}`
          return <Tag key={i}><Inline text={block.text} /></Tag>
        }

        if (block.kind === 'quote') {
          return <p key={i} className="inv-ledger-note"><Inline text={block.text} /></p>
        }

        if (block.kind === 'list') {
          const items = block.items.map((item, n) => <li key={n}><Inline text={item} /></li>)
          // start carries the number the list was written from, so a list
          // that picks up at 3 says 3 rather than starting over.
          return block.ordered
            ? <ol key={i} start={block.start || 1}>{items}</ol>
            : <ul key={i}>{items}</ul>
        }

        if (block.kind === 'table') {
          return (
            <div className="table-wrap" key={i}>
              <table className="jobs-table">
                <thead>
                  <tr>{block.head.map((cell, n) => <th key={n}><Inline text={cell} /></th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.map((row, n) => (
                    <tr key={n}>
                      {row.map((cell, m) => <td key={m}><Inline text={cell} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }

        return <p key={i}><Inline text={block.text} /></p>
      })}
    </div>
  )
}
