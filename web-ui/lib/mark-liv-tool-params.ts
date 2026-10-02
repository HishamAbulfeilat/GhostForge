/**
 * Mark-LV tool declarations use Gemini schema types, which are upper case
 * ('STRING', 'INTEGER', 'NUMBER', 'BOOLEAN', 'ARRAY', 'OBJECT'). JSON Schema
 * uses lower case. Normalise once so both spellings behave the same.
 */
export function normalizeParamType(type?: string): string {
  return typeof type === 'string' ? type.trim().toLowerCase() : ''
}

export type ParamWidget = 'enum' | 'boolean' | 'number' | 'text'

/** Pick the form control for a tool parameter. */
export function paramWidget(param: { type?: string; enum?: unknown[] }): ParamWidget {
  if (Array.isArray(param.enum) && param.enum.length > 0) return 'enum'
  const type = normalizeParamType(param.type)
  if (type === 'boolean') return 'boolean'
  if (type === 'integer' || type === 'number') return 'number'
  return 'text'
}

/** Turn a form value into the JSON type the tool's schema declares. */
export function coerceParam(value: string, type?: string): unknown {
  const t = normalizeParamType(type)
  if (t === 'integer' || t === 'number') {
    const n = Number(value)
    return Number.isFinite(n) && (t === 'number' || Number.isInteger(n)) ? n : value
  }
  if (t === 'boolean') return value.toLowerCase() === 'true'
  if (t === 'array') {
    if (value.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(value)
        if (Array.isArray(parsed)) return parsed
      } catch { /* fall back to comma-separated */ }
    }
    return value.split(',').map(s => s.trim()).filter(Boolean)
  }
  if (t === 'object') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* send as-is; the tool reports the error */ }
  }
  return value
}
