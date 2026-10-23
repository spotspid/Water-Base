import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import QuoteTotals from '../components/QuoteTotals'
import SalesChecklistFields from '../components/SalesChecklistFields'
import { canSend, emptyForm, money, quoteLines, whatIsMissing } from '../lib/quote'
import {
  SITE_KEYS, SIZING_KEYS, checklistFromForm, emptyChecklistForm,
} from '../lib/salesChecklist'
import { loadQuoteSetup, saveQuote } from '../lib/quoteData'
import './NewQuote.css'

// The quoting page, rebuilt.
//
// The first page of v2, and the shape the rest follows. Three rules it keeps
// that the page it replaces did not:
//
//   Only a name is required. Everything else saves blank. A quote often starts
//   as a name and a phone number, and a form that refuses to keep what
//   somebody actually knows sends them to do the work somewhere else: on
//   2026-10-10 a $3,399 sale went out through DocuSeal because Water Base
//   would not take it.
//
//   Nothing resolves to inventory. A preset fills in a price and a parts list
//   as text. No stock is checked, nothing is reserved, and no quote can fail
//   because a part was not found.
//
//   A price nobody set is not a price of zero. An unpriced line leaves the
//   total marked as incomplete rather than quietly summing to something
//   smaller than the job.

const SOURCES = ['City water', 'Well water']
const FINISHES = ['Chrome', 'Brushed Nickel', 'Matte Black', 'Brushed Gold', 'N/A']
const RO_TYPES = ['Tank Style', 'Tankless', 'No RO']
const VALVES = ['Clack', 'Hankscraft']

export default function NewQuote() {
  const [form, setForm] = useState(emptyForm)
  const [checklist, setChecklist] = useState(emptyChecklistForm)
  const [lines, setLines] = useState([])
  const [setup, setSetup] = useState({ org: null, presets: [], extras: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false

    loadQuoteSetup().then(result => {
      if (cancelled) return
      if (result.error) setError(result.error)
      else setSetup(result)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [])

  const change = useCallback(e => {
    const { name, value } = e.target
    setError('')
    setForm(f => ({ ...f, [name]: value }))
  }, [])

  // Picking a preset fills the three things it knows and leaves everything
  // else alone, so a half typed quote is never wiped by a change of mind.
  function pickPreset(preset) {
    setForm(f => ({
      ...f,
      system_name: preset.name,
      system_description: preset.description || '',
      parts_list: preset.parts_list || '',
      sale_price: preset.price == null ? '' : String(preset.price),
    }))
  }

  function addLine(seed) {
    setLines(current => [...current, { key: `line-${Date.now()}-${current.length}`, label: seed?.label ?? '', price: seed?.price == null ? '' : String(seed.price) }])
  }

  function changeLine(index, patch) {
    setLines(current => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
  }

  function removeLine(index) {
    setLines(current => current.filter((line, i) => i !== index))
  }

  // The total, worked out from what is typed rather than from what was picked.
  const totals = useMemo(() => {
    const preset = form.sale_price.trim() === ''
      ? { id: 'system', name: form.system_name || 'System', price: null }
      : { id: 'system', name: form.system_name || 'System', price: Number(form.sale_price.replace(/[$,]/g, '')) }

    const extras = lines.map((line, index) => ({
      id: line.key || index,
      label: line.label || 'Line',
      price: line.price.trim() === '' ? null : Number(line.price.replace(/[$,]/g, '')),
    }))

    const priced = extras.map(extra => ({ ...extra, price: extra.price == null ? 0 : extra.price }))
    const result = quoteLines(preset, priced)

    return {
      ...result,
      incomplete: result.incomplete || extras.some(extra => extra.price == null),
    }
  }, [form.sale_price, form.system_name, lines])

  async function handleSave(e) {
    e.preventDefault()

    const missing = whatIsMissing(form)
    if (missing) { setError(missing); return }

    setBusy(true)
    setError('')

    const chosen = lines
      .filter(line => line.label.trim() !== '' || line.price.trim() !== '')
      .map(line => ({ label: line.label.trim() || 'Line', price: Number(line.price.replace(/[$,]/g, '')) || 0 }))

    const answers = checklistFromForm(checklist)

    const { error: saveError, job } = await saveQuote(
      { ...form, people_in_home: checklist.people_in_home, bathrooms: checklist.bathrooms },
      setup.org?.id, chosen, answers)

    setBusy(false)

    if (saveError) { setError(saveError); return }

    setNotice(`Quote saved for ${job.customer_name}.`)
    setForm(emptyForm())
    setChecklist(emptyChecklistForm())
    setLines([])
  }

  const sendable = canSend(form)

  return (
    <AppShell title="New quote">
      {loading && <p className="quote-loading">Loading...</p>}

      {error && <div className="form-error" role="alert"><p>{error}</p></div>}
      {notice && <p className="quote-notice" role="status">{notice}</p>}

      {!loading && !error && (
        <form className="quote-form" onSubmit={handleSave} noValidate>
          <div className="quote-columns">

            <div className="quote-main">

              <section className="quote-card">
                <h2>Customer</h2>
                <div className="quote-grid">
                  <div className="field">
                    <label htmlFor="customer_name">Name</label>
                    <input id="customer_name" name="customer_name" type="text" required
                      value={form.customer_name} onChange={change} disabled={busy} />
                  </div>
                  <div className="field">
                    <label htmlFor="phone">Phone</label>
                    <input id="phone" name="phone" type="tel"
                      value={form.phone} onChange={change} disabled={busy} />
                  </div>
                  <div className="field">
                    <label htmlFor="customer_email">
                      Email <span className="optional">(needed to send)</span>
                    </label>
                    <input id="customer_email" name="customer_email" type="email"
                      value={form.customer_email} onChange={change} disabled={busy} />
                  </div>
                  <div className="field">
                    <label htmlFor="city">City</label>
                    <input id="city" name="city" type="text"
                      value={form.city} onChange={change} disabled={busy} />
                  </div>
                  <div className="field quote-wide">
                    <label htmlFor="address">
                      Address <span className="optional">(optional)</span>
                    </label>
                    <input id="address" name="address" type="text"
                      value={form.address} onChange={change} disabled={busy}
                      placeholder="They can fill this in when they sign" />
                  </div>
                </div>
              </section>

              <section className="quote-card">
                <h2>The water</h2>
                <p className="quote-sub">What they told you on the call.</p>
                <div className="quote-grid">
                  <div className="field">
                    <label htmlFor="water_source">Supply</label>
                    <select id="water_source" name="water_source"
                      value={form.water_source} onChange={change} disabled={busy}>
                      <option value="">Not said</option>
                      {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="field quote-wide">
                    <label htmlFor="water_problems">What is wrong with the water</label>
                    <textarea id="water_problems" name="water_problems" rows="2"
                      value={form.water_problems} onChange={change} disabled={busy}
                      placeholder="Hard water, iron staining, smell" />
                  </div>
                </div>
              </section>

              <section className="quote-card">
                <SalesChecklistFields
                  value={checklist}
                  onChange={setChecklist}
                  keys={SIZING_KEYS}
                  showJobFields={false}
                  title="Sizing"
                  disabled={busy}
                />
              </section>

              <section className="quote-card">
                <SalesChecklistFields
                  value={checklist}
                  onChange={setChecklist}
                  keys={SITE_KEYS}
                  showJobFields={false}
                  title="The site"
                  disabled={busy}
                />
              </section>

              <section className="quote-card">
                <h2>The system</h2>
                <p className="quote-sub">Pick one to fill in the details, then change whatever you need.</p>

                <div className="quote-presets">
                  {setup.presets.map(preset => (
                    <button
                      key={preset.id} type="button" disabled={busy}
                      className={form.system_name === preset.name ? 'quote-preset quote-preset-on' : 'quote-preset'}
                      onClick={() => pickPreset(preset)}
                    >
                      <span className="quote-preset-name">{preset.name}</span>
                      <span className="quote-preset-price">
                        {preset.price == null ? 'No set price' : money(preset.price)}
                      </span>
                    </button>
                  ))}
                </div>

                <div className="field">
                  <label htmlFor="system_description">Description on the quote</label>
                  <textarea id="system_description" name="system_description" rows="2"
                    value={form.system_description} onChange={change} disabled={busy}
                    placeholder="Whole home single tank mixed bed system for filtration and softening" />
                </div>

                <div className="field">
                  <label htmlFor="parts_list">Parts list</label>
                  <textarea id="parts_list" name="parts_list" rows="2"
                    value={form.parts_list} onChange={change} disabled={busy}
                    placeholder="10x54 mixed bed system, control valve, tanked RO unit, RO faucet, 2 bags of salt" />
                </div>

                <div className="quote-grid">
                  <div className="field">
                    <label htmlFor="ro_type">RO type</label>
                    <select id="ro_type" name="ro_type" value={form.ro_type} onChange={change} disabled={busy}>
                      <option value="">Not chosen</option>
                      {RO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="faucet_finish">Faucet finish</label>
                    <select id="faucet_finish" name="faucet_finish" value={form.faucet_finish} onChange={change} disabled={busy}>
                      <option value="">Not chosen</option>
                      {FINISHES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="valve_type">Valve</label>
                    <select id="valve_type" name="valve_type" value={form.valve_type} onChange={change} disabled={busy}>
                      <option value="">Not chosen</option>
                      {VALVES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="field quote-wide">
                    <label htmlFor="site_conditions">
                      Notes for the installer <span className="optional">(optional)</span>
                    </label>
                    <textarea id="site_conditions" name="site_conditions" rows="2"
                      value={form.site_conditions} onChange={change} disabled={busy}
                      placeholder="Crawl space, softener on the first floor, old Culligan already pulled out" />
                  </div>
                </div>
              </section>

            </div>

            <aside className="quote-side">
              <QuoteTotals
                lines={lines}
                total={totals.total === 0 && totals.incomplete ? '' : money(totals.total)}
                incomplete={totals.incomplete}
                price={form.sale_price}
                onPriceChange={change}
                deposit={form.deposit_amount}
                onDepositChange={change}
                onAddLine={addLine}
                onChangeLine={changeLine}
                onRemoveLine={removeLine}
                catalogue={setup.extras}
                busy={busy}
              />

              <div className="quote-actions">
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving...' : 'Save quote'}
                </button>
                <button type="button" className="btn-cancel" disabled={busy || !sendable}
                  title={sendable ? undefined : 'Add an email address first.'}>
                  Save and send
                </button>
              </div>

              {!sendable && (
                <p className="quote-hint quote-hint-block">
                  Add an email address to send this.
                </p>
              )}
            </aside>

          </div>
        </form>
      )}
    </AppShell>
  )
}
