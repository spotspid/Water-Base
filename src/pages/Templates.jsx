import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { groupLinesByTemplate, sortTemplates } from '../lib/templates'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import TemplateCard from '../components/TemplateCard'
import TemplateFormModal from '../components/TemplateFormModal'
import TemplateLineModal from '../components/TemplateLineModal'
import './Templates.css'

export default function Templates() {
  const [templates, setTemplates] = useState([])
  const [lines, setLines] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [lineTarget, setLineTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [tplRes, lineRes, itemRes] = await Promise.all([
      attempt(
        () => supabase
          .from('system_templates')
          .select('id, label, default_price, active, sort_order, notes'),
        'Templates could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('template_line_preview')
          .select('id, template_id, line_type, item_id, pick_source, pick_category, quantity, sort_order, note, sku, item_name, item_category, item_variant, unit_cost, line_cost'),
        'Template parts could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('inventory_items')
          .select('id, sku, name, category, variant, unit_cost, active')
          .order('name'),
        'Inventory items could not be loaded.',
      ),
    ])

    const firstError = tplRes.error || lineRes.error || itemRes.error
    if (firstError) {
      setError(firstError)
      setTemplates([])
      setLines([])
      setItems([])
    } else {
      setTemplates(sortTemplates(tplRes.data || []))
      setLines(lineRes.data || [])
      setItems(itemRes.data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const linesByTemplate = useMemo(() => groupLinesByTemplate(lines), [lines])

  const templatesWithoutParts = useMemo(
    () => templates.filter(t => !(linesByTemplate.get(t.id) || []).length).length,
    [templates, linesByTemplate],
  )

  function handleSaved(message) {
    setEditingTemplate(null)
    setLineTarget(null)
    setActionError('')
    setNotice(message || '')
    load()
  }

  // A failed delete is reported inline. It must not replace the page with the
  // load error box, since everything on screen is still valid.
  async function handleDeleteLine(line) {
    setNotice('')
    setActionError('')

    const { error: err } = await attempt(
      () => supabase.from('template_lines').delete().eq('id', line.id),
      'That part could not be removed.',
    )

    if (err) {
      setActionError(err)
      return
    }

    setNotice('Part removed from the template.')
    load()
  }

  const hasData = !loading && !error

  return (
    <AppShell>
      <div className="tpl-page">
        <div className="tpl-header">
          <div>
            <h1>Templates</h1>
            <p className="tpl-sub">
              Each system carries a parts list. Marking a job installed deducts this list
              from inventory once, and reversing the status puts it back.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => setEditingTemplate({})}
            disabled={loading || !!error}
          >
            + New Template
          </button>
        </div>

        {hasData && templates.length > 0 && (
          <div className="inv-summary">
            <div className="inv-stat inv-stat-lead">
              <span className="inv-stat-label">Templates</span>
              <span className="inv-stat-value">{templates.length}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Parts Lines</span>
              <span className="inv-stat-value">{lines.length}</span>
            </div>
            <div className={templatesWithoutParts > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Without Parts</span>
              <span className="inv-stat-value">{templatesWithoutParts}</span>
            </div>
          </div>
        )}

        {notice && <p className="tpl-notice" role="status">{notice}</p>}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}

        {loading && <p className="inv-state">Loading templates...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Templates could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              If the template tables have not been created yet, apply
              {' '}<code>supabase/migrations/20260819000000_create_templates_bom.sql</code> and
              {' '}<code>supabase/migrations/20260819000100_job_install_functions.sql</code>, then reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && items.length === 0 && (
          <p className="form-warning" role="status">
            There are no inventory items yet, so parts cannot be added to a template.
            Add items on the Inventory page first.
          </p>
        )}

        {hasData && templates.length === 0 && (
          <EmptyState
            title="No templates yet"
            actions={(
              <button type="button" className="btn-primary" onClick={() => setEditingTemplate({})}>
                Create your first template
              </button>
            )}
          >
            <p>
              A template is the parts list for a system you sell. Installing a job deducts
              exactly what its template says, at the cost stamped on each part that day, so
              margin does not move when a supplier price changes later.
            </p>
            <p>
              A line can also defer a choice to the customer, like a faucet finish, and
              resolve to the matching item when the job installs.
            </p>
          </EmptyState>
        )}

        {hasData && templates.map(template => (
          <TemplateCard
            key={template.id}
            template={template}
            lines={linesByTemplate.get(template.id) || []}
            items={items}
            onEditTemplate={() => setEditingTemplate(template)}
            onAddLine={() => setLineTarget({ template, line: null })}
            onEditLine={line => setLineTarget({ template, line })}
            onDeleteLine={handleDeleteLine}
          />
        ))}
      </div>

      {editingTemplate && (
        <TemplateFormModal
          template={editingTemplate.id ? editingTemplate : null}
          onClose={() => setEditingTemplate(null)}
          onSaved={handleSaved}
        />
      )}

      {lineTarget && (
        <TemplateLineModal
          template={lineTarget.template}
          line={lineTarget.line}
          items={items}
          existingLines={linesByTemplate.get(lineTarget.template.id) || []}
          onClose={() => setLineTarget(null)}
          onSaved={handleSaved}
        />
      )}
    </AppShell>
  )
}
