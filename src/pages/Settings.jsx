import { useSettings } from '../lib/settings'
import AppShell from '../components/AppShell'
import OperationSettings from '../components/OperationSettings'
import OptionListEditor from '../components/OptionListEditor'
import TransactionTypeEditor from '../components/TransactionTypeEditor'
import './Settings.css'

const LISTS = [
  {
    listKey: 'inventory_category',
    title: 'Inventory Categories',
    description: 'Grouping for catalog items, and the pool a customer pick line draws from.',
  },
  {
    listKey: 'service_city',
    title: 'Service Cities',
    description: 'The cities offered when a job is written up.',
  },
  {
    listKey: 'faucet_finish',
    title: 'Faucet Finishes',
    description: 'Matched against the variant on an inventory item when a job installs.',
  },
  {
    listKey: 'payment_type',
    title: 'Payment Types',
    description: 'How a customer paid, recorded on the job.',
  },
]

export default function Settings() {
  const settings = useSettings()
  const { loading, error, reload, allOptions, allTxnTypes } = settings

  return (
    <AppShell>
      <div className="set-page">
        <div className="set-header">
          <div>
            <h1>Settings</h1>
            <p className="set-sub">
              These lists used to be fixed in the code. Editing one here changes what the
              forms offer from now on. Records already saved keep the wording they were
              saved with, so nothing behind you is rewritten.
            </p>
          </div>
        </div>

        {loading && <p className="inv-state">Loading settings...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Settings could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              If the settings tables have not been created yet, apply
              {' '}<code>supabase/migrations/20260820_create_settings.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={reload}>Try again</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <OperationSettings settings={settings} onChanged={reload} />

            <TransactionTypeEditor types={allTxnTypes} onChanged={reload} />

            {LISTS.map(list => (
              <OptionListEditor
                key={list.listKey}
                listKey={list.listKey}
                title={list.title}
                description={list.description}
                rows={allOptions[list.listKey] || []}
                onChanged={reload}
              />
            ))}

            <p className="inv-ledger-note">
              Job statuses and customer pick sources are not here. Both are wired into
              database constraints and the install functions, so changing one is a code
              change rather than a setting.
            </p>
          </>
        )}
      </div>
    </AppShell>
  )
}
