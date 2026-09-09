import { useSettings, withCurrent } from '../lib/settings'

export default function CustomerFields({ form, onChange, disabled }) {
  const { cities, loading } = useSettings()
  const cityOptions = withCurrent(cities, form.city)

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
          <select id="city" name="city" required
            value={form.city} onChange={onChange} disabled={disabled || loading}>
            <option value="">{loading ? 'Loading cities...' : 'Select city...'}</option>
            {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
