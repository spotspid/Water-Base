import { useEffect, useRef, useState } from 'react'
import { columnsThatFit, fitColumns } from './grid'

/**
 * A ref for a card grid and the column count that fits its cards evenly.
 *
 * Measures the grid itself, so the answer follows the real width rather than
 * a guess about the viewport. Null until the first measurement, and null for
 * good where ResizeObserver is missing, which leaves the stylesheet's auto-fit
 * rule in charge rather than forcing a count that was never checked.
 */
export function useFitColumns(count, { minWidth = 180, gap = 16 } = {}) {
  const ref = useRef(null)
  const [cols, setCols] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined

    const measure = () => {
      const width = el.getBoundingClientRect().width
      if (!width) return
      setCols(fitColumns(count, columnsThatFit(width, minWidth, gap)))
    }

    measure()

    let observer
    try {
      observer = new ResizeObserver(measure)
      observer.observe(el)
    } catch {
      return undefined
    }

    return () => observer.disconnect()
  }, [count, minWidth, gap])

  return [ref, cols]
}
