import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { parseMarkdown, titleOf } from '../lib/markdown'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import MarkdownDoc from '../components/MarkdownDoc'
// The guides borrow the page frame and the table rules the rest of the app
// uses, which live here. Vite ships one stylesheet per route, so without this
// import the tables would render bare on this route alone.
import './Jobs.css'

// The guides in docs/, as pages.
//
// The files are the source. They are written to be read in the repo as well as
// here, so nothing about them is app specific, and this page does not keep its
// own copy of anything: Vite reads the folder at build time, so adding a guide
// to docs/ adds a page here with no code change.
const FILES = import.meta.glob('/docs/*.md', { query: '?raw', import: 'default', eager: true })

// README is the contents list rather than a guide of its own.
const INDEX = 'readme'

const GUIDES = Object.entries(FILES)
  .map(([path, source]) => {
    const slug = path.split('/').pop().replace(/\.md$/, '').toLowerCase()
    const blocks = parseMarkdown(source)
    return { slug, blocks, title: titleOf(blocks) || slug }
  })
  .sort((a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))

const index = GUIDES.find(guide => guide.slug === INDEX) || null
const pages = GUIDES.filter(guide => guide.slug !== INDEX)

export default function Help() {
  const { slug } = useParams()
  const wanted = String(slug || '').toLowerCase()

  const guide = useMemo(
    () => (wanted ? pages.find(page => page.slug === wanted) || null : null),
    [wanted],
  )

  // The contents list, with every guide on it whether or not the index names
  // it. A guide added to docs/ and forgotten in the index would otherwise have
  // a page nobody could reach.
  if (!wanted) {
    return (
      <AppShell subtitle={`${pages.length} ${pages.length === 1 ? 'guide' : 'guides'}`}>
        <div className="jobs-page">
          {index && <MarkdownDoc blocks={index.blocks} />}

          {pages.length === 0 && (
            <EmptyState title="No guides yet" compact>
              <p>The guides live in the docs folder. Add one there and it appears here.</p>
            </EmptyState>
          )}

          {pages.length > 0 && (
            <ul>
              {pages.map(page => (
                <li key={page.slug}>
                  <Link to={`/help/${page.slug}`} className="tpl-link">{page.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </AppShell>
    )
  }

  if (!guide) {
    return (
      <AppShell>
        <div className="jobs-page">
          <EmptyState title="No such guide" tone="filtered" compact
            actions={<Link to="/help" className="btn-primary">All guides</Link>}>
            <p>
              There is no guide called &ldquo;{wanted}&rdquo;. The ones that exist are listed on
              the contents page.
            </p>
          </EmptyState>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell subtitle={guide.title}>
      <div className="jobs-page">
        <p>
          <Link to="/help" className="tpl-link">All guides</Link>
        </p>

        <MarkdownDoc blocks={guide.blocks} />
      </div>
    </AppShell>
  )
}
