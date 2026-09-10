import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import './Agreement.css'

// The template id per agreement type, which is the one thing about DocuSeal an
// operator needs to change without a deploy. The API key is not here and never
// will be: it lives as an edge function secret, because anything this page can
// read Vite would inline into the published bundle.
//
// Every save reloads the rows. The first load shows a loading line; later
// ones refresh in place, and a template id somebody is still typing in one
// row survives a save on the other. It used to be replaced from the database
// on every reload, so ticking Active on one row wiped the id pasted into the
// other.
export default function AgreementTypeEditor() {
  const [rows, setRows] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [busyType, setBusyType] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const rowsRef = useRef([])

  const load = useCallback(async () => {
    const first = rowsRef.current.length === 0
    if (first) setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.from('agreement_types')
        .select('type, label, description, docuseal_template_id, active, sort_order')
        .order('sort_order'),
      'The agreement types could not be loaded.',
    )

    if (err) {
      setError(err)
      if (first) setRows([])
    } else {
      const next = data || []
      const before = new Map(rowsRef.current.map(r => [r.type, r.docuseal_template_id || '']))
      rowsRef.current = next
      setRows(next)
      // keep a draft that differs from what it was loaded against, follow the
      // database for everything else
      setDrafts(prev => Object.fromEntries(next.map(r => {
        const stored = r.docuseal_template_id || ''
        const typed = prev[r.type]
        const dirty = typed !== undefined && before.has(r.type)
          && typed.trim() !== before.get(r.type)
        return [r.type, dirty ? typed : stored]
      })))
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(row, patch, message) {
    setError('')
    setNotice('')
    setBusyType(row.type)

    const { error: err } = await attemptRows(
      () => supabase.from('agreement_types')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('type', row.type),
      `${row.label} could not be saved.`,
    )

    setBusyType('')

    if (err) {
      setError(err)
      return
    }

    setNotice(message)
    load()
  }

  if (loading) {
    return <p className="inv-state">Loading agreement types...</p>
  }

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Agreements</h2>
          <p className="set-card-desc">
            The DocuSeal template each agreement uses. Field names are matched against the
            template when an agreement is sent, so renaming a field in DocuSeal shows up as
            a clear error rather than a blank contract.
          </p>
        </div>
        <span className="set-count">{rows.length}</span>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}

      <div className="agr-type-list">
        {rows.map(row => {
          const busy = busyType === row.type
          const draft = drafts[row.type] ?? ''
          const dirty = draft.trim() !== (row.docuseal_template_id || '')

          return (
            <div className="agr-type" key={row.type}>
              <div className="agr-type-head">
                <div>
                  <h3>{row.label}</h3>
                  {row.description && <p className="agr-sub">{row.description}</p>}
                </div>
                <label className="agr-toggle">
                  <input
                    type="checkbox"
                    checked={row.active}
                    disabled={busy}
                    onChange={e => save(
                      row,
                      { active: e.target.checked },
                      e.target.checked
                        ? `${row.label} is on.`
                        : `${row.label} is off and cannot be sent.`,
                    )}
                  />
                  Active
                </label>
              </div>

              <div className="agr-type-row">
                <div className="field">
                  <label htmlFor={`tpl-${row.type}`}>DocuSeal template id</label>
                  <input
                    id={`tpl-${row.type}`}
                    type="text"
                    value={draft}
                    disabled={busy}
                    placeholder="for example 123456"
                    onChange={e => setDrafts(d => ({ ...d, [row.type]: e.target.value }))}
                  />
                  <span className="field-hint">
                    From the template URL in DocuSeal. Blank means this agreement cannot be sent.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !dirty}
                  onClick={() => save(
                    row,
                    { docuseal_template_id: draft.trim() || null },
                    `${row.label} template id saved.`,
                  )}
                >
                  {busy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <p className="inv-ledger-note">
        The DocuSeal API key is an edge function secret, not a setting. It is never sent to
        the browser, because the build would inline it into a file anyone can read.
      </p>
    </section>
  )
}
