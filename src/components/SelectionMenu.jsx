import { useLayoutEffect, useRef, useState } from 'react'
import { OPERATIONS } from '../core/operations'

/**
 * The menu that appears over a selection.
 *
 * This is where the reader authors the link: they have chosen the passage,
 * and here they choose what the passage should resolve to. The menu is the
 * visible form of the idea that a link's destination is decided at reading
 * time, not at writing time.
 *
 * Positioning runs in a layout effect so the measure-and-place happens
 * before the browser paints - the menu never appears in the wrong spot
 * and then jump to the right one.
 */
export default function SelectionMenu({ selection, onRun }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!selection) {
      setPos(null)
      return
    }
    const el = ref.current
    if (!el) return

    const menu = el.getBoundingClientRect()
    const { rect } = selection
    const gap = 10

    // Prefer above the selection; drop below if there is no room.
    let top = rect.top - menu.height - gap
    if (top < 8) top = rect.top + rect.height + gap

    // Centre on the selection, kept inside the viewport.
    let left = rect.left + rect.width / 2 - menu.width / 2
    left = Math.max(8, Math.min(left, window.innerWidth - menu.width - 8))

    setPos({ top, left })
  }, [selection])

  if (!selection) return null

  return (
    <div
      className="menu"
      ref={ref}
      role="toolbar"
      aria-label="What would you like to know about this passage?"
      style={{
        top: `${pos?.top ?? 0}px`,
        left: `${pos?.left ?? 0}px`,
        visibility: pos ? 'visible' : 'hidden',
      }}
      // Keep the browser from clearing the selection when the menu is clicked.
      onMouseDown={(e) => e.preventDefault()}
    >
      {OPERATIONS.map((op) => (
        <button
          key={op.id}
          className="menu__item"
          title={op.hint}
          onClick={() => onRun(op)}
        >
          {op.label}
        </button>
      ))}
    </div>
  )
}
