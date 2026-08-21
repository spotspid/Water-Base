import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'
import { SettingsContext, groupOptions, readScalars, sortTxnTypes } from './settings'

// Everything an operator can edit on the Settings page, loaded once per
// signed in session and shared by every page that used to read a hardcoded
// array out of constants.js.
export function SettingsProvider({ children }) {
  const [allOptions, setAllOptions] = useState([])
  const [allTxnTypes, setAllTxnTypes] = useState([])
  const [scalarRows, setScalarRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')

    const [optionRes, typeRes, scalarRes] = await Promise.all([
      attempt(
        () => supabase
          .from('settings_options')
          .select('id, list_key, value, sort_order, active'),
        'Settings lists could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('transaction_types')
          .select('value, label, direction, help, sort_order, active, is_system'),
        'Transaction types could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('app_settings')
          .select('key, numeric_value, text_value, updated_at'),
        'Settings could not be loaded.',
      ),
    ])

    const firstError = optionRes.error || typeRes.error || scalarRes.error

    if (firstError) {
      setError(firstError)
      setAllOptions([])
      setAllTxnTypes([])
      setScalarRows([])
    } else {
      setAllOptions(optionRes.data || [])
      setAllTxnTypes(typeRes.data || [])
      setScalarRows(scalarRes.data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const value = useMemo(() => {
    const grouped = groupOptions(allOptions)
    const sortedTypes = sortTxnTypes(allTxnTypes)
    const activeValues = key => grouped[key].filter(o => o.active).map(o => o.value)

    return {
      loading,
      error,
      reload,
      // raw rows, for the settings editors
      allOptions: grouped,
      allTxnTypes: sortedTypes,
      scalarRows,
      // ready to render lists, for the forms
      categories: activeValues('inventory_category'),
      cities: activeValues('service_city'),
      finishes: activeValues('faucet_finish'),
      paymentTypes: activeValues('payment_type'),
      timeWindows: activeValues('time_window'),
      expenseCategories: activeValues('expense_category'),
      txnTypes: sortedTypes.filter(t => t.active),
      ...readScalars(scalarRows),
    }
  }, [allOptions, allTxnTypes, scalarRows, loading, error, reload])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}
