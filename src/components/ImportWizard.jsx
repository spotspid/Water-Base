import { useCallback, useMemo, useState } from 'react'
import { PRODUCERS, producerById } from '../lib/csvSource'
import {
  REQUIRED_FIELDS, commitBatch, emptyMapping, findDuplicates, prepareRows,
} from '../lib/importPipeline'
import { formatCurrency, sumAmounts } from '../lib/expenses'
import Modal from './Modal'
import ImportMapStep from './ImportMapStep'
import ImportPreviewStep from './ImportPreviewStep'

const STEP_TITLES = {
  pick: 'Import Expenses',
  map: 'Match the columns',
  preview: 'Check before importing',
  done: 'Import complete',
}

// Orchestrates the four pipeline stages. It knows which producer is selected
// and nothing else about file formats, so a second producer needs no changes
// here beyond appearing in PRODUCERS.
export default function ImportWizard({ categories, onClose, onImported }) {
  const [step, setStep] = useState('pick')
  const [producerId, setProducerId] = useState(PRODUCERS[0]?.id || '')
  const [file, setFile] = useState(null)
  const [produced, setProduced] = useState(null)
  const [mapping, setMapping] = useState(emptyMapping())
  const [category, setCategory] = useState('')
  const [flipSigns, setFlipSigns] = useState(false)
  const [duplicates, setDuplicates] = useState(new Map())
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const producer = producerById(producerId)

  const prepared = useMemo(() => {
    if (!produced) return { rows: [], problems: [] }
    return prepareRows(produced.rows, mapping, { category, flipSigns })
  }, [produced, mapping, category, flipSigns])

  const mappingReady = REQUIRED_FIELDS.every(f => mapping[f]) && Boolean(category)

  const handleRead = useCallback(async () => {
    if (!producer) return
    setError('')
    setBusy(true)
    try {
      const output = await producer.produce(file)
      setProduced(output)
      setMapping(producer.suggest ? { ...emptyMapping(), ...producer.suggest(output.columns) } : emptyMapping())
      setStep('map')
    } catch (caught) {
      setError(caught?.message || 'That file could not be read.')
    }
    setBusy(false)
  }, [producer, file])

  const handlePreview = useCallback(async () => {
    setError('')
    setBusy(true)
    const { matches, error: dupeError } = await findDuplicates(prepared.rows)
    setBusy(false)

    // a duplicate check that cannot run is worth saying out loud, but it is
    // not a reason to block an import the operator already decided to make
    if (dupeError) setError(`${dupeError} The rows below are unchecked.`)
    setDuplicates(matches)
    setStep('preview')
  }, [prepared.rows])

  const handleCommit = useCallback(async () => {
    setError('')
    setBusy(true)
    const { data, error: commitError } = await commitBatch(
      producerId,
      produced?.meta?.filename || '',
      prepared.rows,
    )
    setBusy(false)

    if (commitError) {
      setError(commitError)
      return
    }

    const summary = Array.isArray(data) ? data[0] : data
    setResult(summary || { inserted_count: prepared.rows.length })
    setStep('done')
    onImported()
  }, [producerId, produced, prepared.rows, onImported])

  return (
    <Modal
      title={STEP_TITLES[step]}
      subtitle={step === 'done' ? undefined : 'Nothing is saved until the last step.'}
      onClose={onClose}
      wide
    >
      {step === 'pick' && (
        <div className="imp-step">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="imp-producer">Source</label>
              <select id="imp-producer" value={producerId} disabled={busy}
                onChange={e => { setProducerId(e.target.value); setFile(null) }}>
                {PRODUCERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              {producer && <span className="field-hint">{producer.hint}</span>}
            </div>

            <div className="field">
              <label htmlFor="imp-file">File</label>
              <input id="imp-file" type="file" accept={producer?.accept} disabled={busy}
                onChange={e => { setFile(e.target.files?.[0] || null); setError('') }} />
              {file && <span className="field-hint">{file.name}</span>}
            </div>
          </div>

          <p className="field-hint">
            Only one source is wired up today. The steps after this one do not depend on
            it, so a PDF reader can be added beside it later without changing the preview
            or the commit.
          </p>
        </div>
      )}

      {step === 'map' && produced && (
        <ImportMapStep
          columns={produced.columns}
          rows={produced.rows}
          mapping={mapping}
          onMapping={setMapping}
          categories={categories}
          category={category}
          onCategory={setCategory}
          flipSigns={flipSigns}
          onFlipSigns={setFlipSigns}
          disabled={busy}
        />
      )}

      {step === 'preview' && (
        <ImportPreviewStep
          rows={prepared.rows}
          problems={prepared.problems}
          duplicates={duplicates}
          category={category}
        />
      )}

      {step === 'done' && result && (
        <div className="imp-step">
          <div className="txn-effect txn-effect-in">
            <span className="txn-effect-verb">Imported</span>
            <span className="txn-effect-qty">{result.inserted_count}</span>
            <span className="txn-effect-detail">
              {result.total_amount != null && (
                <>totalling <strong>{formatCurrency(result.total_amount)}</strong>, </>
              )}
              recorded as one batch under {category}.
            </span>
          </div>
          <p className="field-hint">
            The batch is listed on the Expenses page and can be reversed as a unit if it
            turns out to be wrong.
          </p>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="modal-actions">
        {step === 'pick' && (
          <>
            <button type="button" className="btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={handleRead} disabled={busy || !file}>
              {busy ? 'Reading...' : 'Read file'}
            </button>
          </>
        )}

        {step === 'map' && (
          <>
            <button type="button" className="btn-cancel" disabled={busy}
              onClick={() => { setStep('pick'); setError('') }}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={handlePreview}
              disabled={busy || !mappingReady || prepared.rows.length === 0}>
              {busy ? 'Checking...' : `Preview ${prepared.rows.length} rows`}
            </button>
          </>
        )}

        {step === 'preview' && (
          <>
            <button type="button" className="btn-cancel" disabled={busy}
              onClick={() => { setStep('map'); setError('') }}>
              Back
            </button>
            <button type="button" className="btn-primary" onClick={handleCommit}
              disabled={busy || prepared.rows.length === 0}>
              {busy
                ? 'Importing...'
                : `Import ${prepared.rows.length} rows, ${formatCurrency(sumAmounts(prepared.rows))}`}
            </button>
          </>
        )}

        {step === 'done' && (
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        )}
      </div>
    </Modal>
  )
}
