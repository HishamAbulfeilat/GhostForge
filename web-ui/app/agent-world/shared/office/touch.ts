// Touch controls for the Agent Office camera: one finger drags the view, two
// fingers pinch to zoom (and pan by their midpoint). Mouse and pen input are
// left to the scene (click, wheel zoom, arrow keys). Manual movement clears
// the scene's follow target, as the minimap and the arrow keys do.

export type TouchCamera = { scrollX: number; scrollY: number; zoom: number; setZoom(zoom: number): unknown }
export type TouchTarget = {
  camera: TouchCamera
  /** Stop following an agent (manual movement wins). */
  release(): void
  /** False while the scene uses the drag itself, e.g. moving a desk in layout edit. */
  canPan(): boolean
}

/** A drag shorter than this stays a tap, so the scene still gets its click. */
export const PAN_SLOP_PX = 8
// The scene's own wheel zoom range.
export const MIN_ZOOM = 1
export const MAX_ZOOM = 3

type Point = { x: number; y: number }
type PointerLike = Event & { pointerId: number; pointerType: string; clientX: number; clientY: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) || 1

/**
 * Listens for touch pointers on `host` and moves the camera `target()` returns
 * (null while the scene is not ready). Returns a function that removes the
 * listeners.
 */
export function attachTouchControls(host: EventTarget, target: () => TouchTarget | null): () => void {
  const points = new Map<number, Point>()
  let drag: { from: Point; scrollX: number; scrollY: number; moving: boolean } | null = null
  let pinch: { dist: number; zoom: number; mid: Point; scrollX: number; scrollY: number } | null = null

  const begin = () => {
    const t = target()
    if (!t) return
    const [a, b] = [...points.values()]
    if (b) {
      pinch = { dist: dist(a, b), zoom: t.camera.zoom, mid: mid(a, b), scrollX: t.camera.scrollX, scrollY: t.camera.scrollY }
      drag = null
    } else if (a) {
      pinch = null
      drag = { from: a, scrollX: t.camera.scrollX, scrollY: t.camera.scrollY, moving: false }
    }
  }

  const down = (e: Event) => {
    const p = e as PointerLike
    if (p.pointerType !== 'touch') return
    points.set(p.pointerId, { x: p.clientX, y: p.clientY })
    if (points.size <= 2) begin()
  }

  const move = (e: Event) => {
    const p = e as PointerLike
    if (p.pointerType !== 'touch' || !points.has(p.pointerId)) return
    points.set(p.pointerId, { x: p.clientX, y: p.clientY })
    const t = target()
    if (!t) return
    const cam = t.camera
    const [a, b] = [...points.values()]
    if (pinch && b) {
      const zoom = clamp(pinch.zoom * (dist(a, b) / pinch.dist), MIN_ZOOM, MAX_ZOOM)
      const m = mid(a, b)
      t.release()
      cam.setZoom(zoom)
      cam.scrollX = pinch.scrollX - (m.x - pinch.mid.x) / zoom
      cam.scrollY = pinch.scrollY - (m.y - pinch.mid.y) / zoom
      return
    }
    if (!drag || !t.canPan()) return
    const dx = a.x - drag.from.x
    const dy = a.y - drag.from.y
    if (!drag.moving && Math.hypot(dx, dy) < PAN_SLOP_PX) return
    drag.moving = true
    t.release()
    cam.scrollX = drag.scrollX - dx / cam.zoom
    cam.scrollY = drag.scrollY - dy / cam.zoom
  }

  const up = (e: Event) => {
    const p = e as PointerLike
    if (!points.delete(p.pointerId)) return
    // One finger left of a pinch: carry on dragging from where it is.
    begin()
    if (!points.size) { drag = null; pinch = null }
  }

  // Capture: seen on the way down to the scene's canvas, whatever it does with them.
  const opts = { capture: true }
  host.addEventListener('pointerdown', down, opts)
  host.addEventListener('pointermove', move, opts)
  host.addEventListener('pointerup', up, opts)
  host.addEventListener('pointercancel', up, opts)
  return () => {
    host.removeEventListener('pointerdown', down, opts)
    host.removeEventListener('pointermove', move, opts)
    host.removeEventListener('pointerup', up, opts)
    host.removeEventListener('pointercancel', up, opts)
  }
}
