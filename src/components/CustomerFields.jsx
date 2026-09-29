import { useSettings } from '../lib/settings'

export default function CustomerFields({ form, onChange, disabled }) {
  // Suggestions, not a list to pick from. The dropdown only held what Settings
  // held, so a customer in Redford Township or Sterling Heights could not be
  // entered without the list being edited first, and two real jobs went in as
  // free text around it. Typing anything is allowed; Settings supplies the
  // names worth not retyping.
  const { cities } = useSettings()

  return (
    <section className="form-section">
      <h2>Customer</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="customer_name">Customer name</label>
          <input id="customer_name" name="customer_name" type="text" required
            value={form.customer_name} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input id="phone" name="phone" type="tel" required
            value={form.phone} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field field-full">
          <label htmlFor="customer_email">
            Email <span className="optional">(needed to send an agreement)</span>
          </label>
          <input id="customer_email" name="customer_email" type="email"
            value={form.customer_email} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field field-full">
          <label htmlFor="address">Address</label>
          <input id="address" name="address" type="text" required
            value={form.address} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="city">City</label>
          <input id="city" name="city" type="text" required
            list="service-city-suggestions" autoComplete="address-level2"
            value={form.city} onChange={onChange} disabled={disabled} />
          {/* The browser shows these as the person types. An empty list, which
              is what Settings holds until Steve refills it, is simply a text
              box with nothing to suggest. */}
          <datalist id="service-city-suggestions">
            {(cities || []).map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="field">
          <label htmlFor="water_source">Water source</label>
          <select id="water_source" name="water_source" required
            value={form.water_source} onChange={onChange} disabled={disabled}>
            <option value="city">City</option>
            <option value="well">Well</option>
          </select>
        </div>
      </div>
    </section>
  )
}
