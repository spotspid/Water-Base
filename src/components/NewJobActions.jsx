// The buttons at the bottom of /jobs/new.
//
// Save quote is the form's submit button, so Enter in a field runs it, and it
// never sends. Save and send quote is a plain button that has to be pressed on
// purpose: it saves the same way, then emails the quote through sendQuote. The
// page decides what each does; this only lays them out and says why the send
// button is off when it is.
//
// savingAs is '' when idle, 'save' or 'send' while one is running, so only the
// button that was pressed changes its label.
export default function NewJobActions({ savingAs, canSend, unavailable, onCancel, onSend }) {
  const saving = savingAs !== ''

  return (
    <>
      <div className="form-actions">
        <button type="button" className="btn-cancel" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn-cancel" disabled={saving || unavailable}>
          {savingAs === 'save' ? 'Saving...' : 'Save quote'}
        </button>
        <button type="button" className="btn-primary" onClick={onSend}
          disabled={saving || unavailable || !canSend}>
          {savingAs === 'send' ? 'Saving and sending...' : 'Save and send quote'}
        </button>
      </div>

      {/* Said on the page rather than in a tooltip, which a tablet never
          shows: why the send button is dead. */}
      {!canSend && (
        <p className="field-hint form-actions-note">
          Save and send quote is only for a job with status Quoted. Save quote saves it
          without sending anything.
        </p>
      )}
    </>
  )
}
