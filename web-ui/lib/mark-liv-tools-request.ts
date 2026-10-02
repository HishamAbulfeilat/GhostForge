/**
 * Validation for /api/mark-liv-tools (the web panel for weather, flights,
 * reminders and the Mark-LV tool runner). Pure — no I/O — so it can be unit
 * tested and so the route only ever forwards a fixed bridge endpoint with a
 * whitelisted, size-limited payload.
 */
import { markLivRisk } from './mark-liv-risk'

export type MarkLivToolsKind = 'weather' | 'flight' | 'reminder' | 'run'

export interface MarkLivToolsRequest {
  kind: MarkLivToolsKind
  endpoint: string
  permission: string
  payload: Record<string, unknown>
  /** Set for risky tool runs; the caller must resend with confirm: true. */
  confirmReason?: string
}

export type ParseResult = { ok: true; request: MarkLivToolsRequest } | { ok: false; error: string }

const CABINS = new Set(['economy', 'premium', 'business', 'first'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/

function text(body: Record<string, unknown>, key: string, max: number): string | null | undefined {
  const value = body[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length > max) return null
  return trimmed || undefined
}

function fail(error: string): ParseResult {
  return { ok: false, error }
}

export function parseMarkLivToolsRequest(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Body must be a JSON object')
  const body = raw as Record<string, unknown>

  switch (body.kind) {
    case 'weather': {
      const city = text(body, 'city', 100)
      if (!city) return fail('city is required (max 100 characters)')
      return { ok: true, request: { kind: 'weather', endpoint: '/api/mark-l/weather', permission: 'weather', payload: { city } } }
    }

    case 'flight': {
      const from = text(body, 'from_city', 100)
      const to = text(body, 'to_city', 100)
      const date = text(body, 'date', 10)
      const returnDate = text(body, 'return_date', 10)
      const cabin = text(body, 'cabin', 20) ?? 'economy'
      if (!from || !to) return fail('from_city and to_city are required (max 100 characters)')
      if (date === null || (date && !DATE_RE.test(date))) return fail('date must be YYYY-MM-DD')
      if (returnDate === null || (returnDate && !DATE_RE.test(returnDate))) return fail('return_date must be YYYY-MM-DD')
      if (cabin === null || !CABINS.has(cabin)) return fail('cabin must be economy, premium, business or first')
      const passengers = body.passengers === undefined || body.passengers === '' ? 1 : Number(body.passengers)
      if (!Number.isInteger(passengers) || passengers < 1 || passengers > 9) return fail('passengers must be 1-9')
      return {
        ok: true,
        request: {
          kind: 'flight',
          endpoint: '/api/mark-l/flight-finder',
          permission: 'web_search',
          payload: { from_city: from, to_city: to, date: date ?? '', return_date: returnDate ?? '', passengers, cabin },
        },
      }
    }

    case 'reminder': {
      const message = text(body, 'message', 500)
      const date = text(body, 'date', 10)
      const time = text(body, 'time', 5)
      if (!message) return fail('message is required (max 500 characters)')
      if (!date || !DATE_RE.test(date)) return fail('date must be YYYY-MM-DD')
      if (!time || !TIME_RE.test(time)) return fail('time must be HH:MM (24-hour)')
      return { ok: true, request: { kind: 'reminder', endpoint: '/api/mark-l/reminder', permission: 'reminders', payload: { date, time, message } } }
    }

    case 'run': {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!TOOL_NAME_RE.test(name)) return fail('name must be a Mark-LV tool name')
      const parameters = body.parameters ?? {}
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return fail('parameters must be an object')
      if (JSON.stringify(parameters).length > 8_000) return fail('parameters are too large')
      const reason = markLivRisk(name, parameters as Record<string, unknown>)
      return {
        ok: true,
        request: {
          kind: 'run',
          endpoint: '/api/mark-liv/run',
          // Same gate JARVIS uses for its mark_liv tool (lib/tool-permissions.ts).
          permission: 'mac_control',
          payload: { name, parameters },
          ...(reason && body.confirm !== true ? { confirmReason: reason } : {}),
        },
      }
    }

    default:
      return fail('kind must be weather, flight, reminder or run')
  }
}
