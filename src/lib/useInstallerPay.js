import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

// What the pay box should say, asked of the database rather than worked out
// twice.
//
// suggest_pay_for takes the three facts the form has in its hands, a build
// sheet, an RO type and an installer, so the New job form and the job drawer
// ask the same question of the same rules. The job drawer could call the by id
// version instead, but then a crew change in the drawer would show the old
// rate until the row was saved, which is exactly when somebody needs to see
// the new one.
//
// Nothing here writes. The suggestion is offered beside the box; what the box
// holds stays whatever a person put in it.
export function useInstallerPay({ templateId, roType, installerId }) {
  const [suggestion, setSuggestion] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!templateId) {
      setSuggestion(null)
      return
    }

    setLoading(true)

    const { data, error } = await supabase.rpc('suggest_pay_for', {
      p_template_id: templateId,
      p_ro_type: roType || null,
      p_installer_id: installerId || null,
    })

    setLoading(false)

    // A failed lookup leaves the box alone rather than showing a wrong rate.
    // The pay can always be typed, which is what it was before any of this.
    if (error) {
      setSuggestion(null)
      return
    }

    setSuggestion(Array.isArray(data) ? data[0] || null : data || null)
  }, [templateId, roType, installerId])

  useEffect(() => { load() }, [load])

  return { suggestion, loading, reload: load }
}
