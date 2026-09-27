import { useEffect } from 'react'
import './Modal.css'

/**
 * dismissOnBackdrop false for anything holding work.
 *
 * The job drawer saves as you go, and the way to finish typing in a box is to
 * click somewhere else. Somewhere else was usually the backdrop, which closed
 * the drawer and left the reader on the jobs list, one page away from the
 * documents page they had opened the job from. A working surface should be
 * left by pressing something that means leave.
 */
export default function Modal({
  title, subtitle, onClose, wide = false, dismissOnBackdrop = true, children,
}) {
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={dismissOnBackdrop ? onClose : undefined}>
      <div
        className={wide ? 'modal modal-wide' : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-titles">
            <h2>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
