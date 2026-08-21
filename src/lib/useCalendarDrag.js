import { useCallback, useEffect, useRef, useState } from 'react'

// Dragging a job to another day, on a mouse and on a finger.
//
// This replaces HTML5 drag and drop, which does not exist on touch at all.
// Pointer events cover both, so there is one code path rather than a desktop
// one and a mobile one that drift apart.
//
// The two input types need different starts, though, and that is the whole
// difficulty. A mouse press that moves is unambiguously a drag. A finger
// press that moves is far more likely to be someone scrolling the page. So a
// finger has to hold still for a moment first, and if it moves before that
// moment is up, the gesture is handed back to the browser as a scroll.

const MOUSE_THRESHOLD = 4     // px of movement before a mouse press is a drag
const TOUCH_HOLD_MS = 220     // how long a finger rests before it picks up
const TOUCH_SLOP = 8          // px a finger may drift during that rest
const CLICK_SUPPRESS_MS = 60  // ignore the click that follows a real drag

export function useCalendarDrag({ onDrop, canDrag }) {
  // everything the gesture needs between events, kept in a ref so the window
  // listeners do not need re-binding on every pointer move
  const gesture = useRef(null)
  const suppressUntil = useRef(0)
  const [drag, setDrag] = useState(null)

  const reset = useCallback(() => {
    const active = gesture.current?.active
    if (gesture.current?.timer) clearTimeout(gesture.current.timer)
    gesture.current = null
    setDrag(null)
    if (active) suppressUntil.current = Date.now() + CLICK_SUPPRESS_MS
  }, [])

  // The cell under the pointer right now. The floating preview is
  // pointer-events none, so it never shadows the cell beneath it.
  const targetAt = useCallback((x, y) => {
    const el = document.elementFromPoint(x, y)
    if (!el || typeof el.closest !== 'function') return ''
    const cell = el.closest('[data-drop-date]')
    return cell ? cell.getAttribute('data-drop-date') || '' : ''
  }, [])

  const activate = useCallback((x, y) => {
    const g = gesture.current
    if (!g || g.active) return
    g.active = true
    if (g.timer) { clearTimeout(g.timer); g.timer = null }
    setDrag({ jobId: g.job.id, job: g.job, x, y, overKey: targetAt(x, y) })
  }, [targetAt])

  useEffect(() => {
    function handleMove(e) {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return

      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      const distance = Math.hypot(dx, dy)

      if (!g.active) {
        // a finger that moves before the hold elapses was scrolling, so let
        // the browser have the gesture back
        if (g.touch) {
          if (distance > TOUCH_SLOP) reset()
          return
        }
        if (distance > MOUSE_THRESHOLD) activate(e.clientX, e.clientY)
        return
      }

      setDrag(current => (current ? {
        ...current,
        x: e.clientX,
        y: e.clientY,
        overKey: targetAt(e.clientX, e.clientY),
      } : current))
    }

    function handleUp(e) {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return

      const wasActive = g.active
      const job = g.job
      const key = wasActive ? targetAt(e.clientX, e.clientY) : ''

      reset()

      if (wasActive && key) onDrop(job, key)
    }

    function handleCancel(e) {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      reset()
    }

    function handleKey(e) {
      if (e.key === 'Escape' && gesture.current) reset()
    }

    // Non passive, because stopping the page from scrolling under a lifted
    // card is the entire point and a passive listener cannot preventDefault.
    function handleTouchMove(e) {
      if (gesture.current?.active) e.preventDefault()
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('keydown', handleKey)
    document.addEventListener('touchmove', handleTouchMove, { passive: false })

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('keydown', handleKey)
      document.removeEventListener('touchmove', handleTouchMove)
    }
  }, [activate, onDrop, reset, targetAt])

  // Released when the component unmounts mid drag, so a stray timer cannot
  // fire into a torn down tree.
  useEffect(() => reset, [reset])

  const onPointerDown = useCallback((e, job) => {
    if (!canDrag(job)) return
    // right and middle buttons are not drags
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (gesture.current) reset()

    const touch = e.pointerType !== 'mouse'

    gesture.current = {
      job,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      touch,
      active: false,
      timer: null,
    }

    if (touch) {
      const { clientX, clientY } = e
      gesture.current.timer = setTimeout(() => activate(clientX, clientY), TOUCH_HOLD_MS)
    }
  }, [activate, canDrag, reset])

  // A drag ends with a pointerup over the card, which the browser then turns
  // into a click. Without this the drop would also open the job.
  const swallowedClick = useCallback(() => Date.now() < suppressUntil.current, [])

  return { drag, onPointerDown, swallowedClick }
}
