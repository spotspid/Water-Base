import { useSettings } from '../lib/settings'
import { useInstallers } from '../lib/useInstallers'
import AppShell from '../components/AppShell'
import OperationSettings from '../components/OperationSettings'
import AgreementTypeEditor from '../components/AgreementTypeEditor'
import InstallerEditor from '../components/InstallerEditor'
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
  {
    listKey: 'time_window',
    title: 'Time Windows',
    description: 'The arrival windows a job can be scheduled into.',
  },
  {
    listKey: 'expense_category',
    title: 'Expense Categories',
    description: 'How spending is grouped on the Expenses page and the profit and loss.',
  },
  {
    listKey: 'ro_type',
    title: 'RO Types',
    description: 'Matched against the variant on an inventory item when a job installs.',
  },
]

export default function Settings() {
  const settings = useSettings()
  const { loading, loaded, error, reload, allOptions, allTxnTypes } = settings
  const {
    installers,
    loading: loadingCrew,
    error: crewError,
    reload: reloadCrew,
  } = useInstallers()

  return (
    <AppShell>
      <div className="set-page">
        <p className="set-sub">
          These lists used to be fixed in the code. Editing one here changes what the
          forms offer from now on. Records already saved keep the wording they were
          saved with, so nothing behind you is rewritten.
        </p>

        {loading && <p className="inv-state">Loading settings...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Settings could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              If the settings tables have not been created yet, apply
              {' '}<code>supabase/migrations/20260820000000_create_settings.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={reload}>Try again</button>
          </div>
        )}

        {/* Gated on loaded rather than on loading, so a reload after a save
            leaves every card mounted with whatever is typed in it. A refresh
            that fails shows the error above cards that still hold data. */}
        {loaded && (
          <>
            <OperationSettings settings={settings} onChanged={reload} />

            <AgreementTypeEditor />

            {crewError ? (
              <div className="inv-error-box" role="alert">
                <p className="inv-error-title">The installer roster could not be loaded.</p>
                <p className="inv-error-detail">{crewError}</p>
                <p className="inv-error-hint">
                  If the roster has not been created yet, apply
                  {' '}<code>supabase/migrations/20260822000000_create_scheduling.sql</code> and reload.
                </p>
                <button type="button" className="btn-cancel" onClick={reloadCrew}>Try again</button>
              </div>
            ) : loadingCrew ? (
              <p className="inv-state">Loading the installer roster...</p>
            ) : (
              <InstallerEditor installers={installers} onChanged={reloadCrew} />
            )}

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
