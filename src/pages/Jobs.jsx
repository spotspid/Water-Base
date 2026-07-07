import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS } from '../lib/constants'
import AppShell from '../components/AppShell'
import './Jobs.css'

export default function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const { data, error: err } = await supabase
        .from('jobs')
        .select('id, created_at, customer_name, city, system_template, sale_price, status')
        .order('created_at', { ascending: false })

      if (err) {
        setError(err.message)
      } else {
        setJobs(data)
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <AppShell>
      <div className="jobs-page">
        <div className="jobs-header">
          <h1>Jobs</h1>
          <Link to="/jobs/new" className="btn-primary">+ New Job</Link>
        </div>

        {loading && <p className="jobs-state">Loading...</p>}
        {error && <p className="jobs-state jobs-error">{error}</p>}

        {!loading && !error && jobs.length === 0 && (
          <p className="jobs-state">No jobs yet. Add your first one.</p>
        )}

        {!loading && !error && jobs.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>City</th>
                  <th>System</th>
                  <th>Sale Price</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id}>
                    <td className="td-customer">{job.customer_name}</td>
                    <td>{job.city}</td>
                    <td>{job.system_template}</td>
                    <td>${Number(job.sale_price).toLocaleString('en-US', { minimumFractionDigits: 0 })}</td>
                    <td>
                      <span className={`status-badge status-${job.status}`}>
                        {STATUS_LABELS[job.status]}
                      </span>
                    </td>
                    <td>{new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
