import { SITE_KEYS, SIZING_KEYS } from '../lib/salesChecklist'
import SalesChecklistFields from './SalesChecklistFields'

// The two halves of the sales checklist on the New job form.
//
// Both come before the System section on purpose: sizing decides which system
// to quote, and site is asked in the same walk round the house, before anybody
// sits down to pick equipment.
//
// Shown only while the job is a quote. Once it is sold the answers belong to
// the job and are edited in its drawer, so the form stops asking.
export default function NewJobChecklist({ checklist, onChange, form, disabled }) {
  return (
    <>
      <SalesChecklistFields
        title="Sales checklist: sizing"
        keys={SIZING_KEYS}
        showJobFields={false}
        value={checklist}
        onChange={onChange}
        job={form}
        disabled={disabled}
      />

      <SalesChecklistFields
        title="Sales checklist: site"
        keys={SITE_KEYS}
        value={checklist}
        onChange={onChange}
        job={form}
        disabled={disabled}
        jobFieldsNote="Faucet finish, RO type and payment type are chosen in the System section below."
      />
    </>
  )
}
