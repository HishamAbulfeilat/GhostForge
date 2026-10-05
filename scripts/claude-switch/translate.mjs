// Anthropic Messages API <-> OpenAI Chat Completions translation, so Claude Code
// (which speaks Anthropic) can run on any OpenAI-compatible free provider.

const textOf = c => typeof c === 'string' ? c
  : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : ''

// Marks the small "answered by provider/model X" line claude-switch prepends to
// free-served replies, so Claude Code (and the user) can see which free model
// answered. Stripped back out of history before it's replayed upstream.
const BANNER_RE = /^⟦[^⟧]*⟧\n?/

/** Anthropic /v1/messages body -> OpenAI /chat/completions body. */
export function toOpenAI(body, model) {
  const messages = []
  const system = textOf(body.system)
  if (system) messages.push({ role: 'system', content: system })
  // A nameless tool call (left in history by an older translator) makes every
  // provider reject the whole request with 400, so drop it and its result.
  const dropped = new Set()
  for (const m of body.messages ?? []) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    for (const b of m.content) if (b.type === 'tool_use' && !b.name) dropped.add(b.id)
  }
  for (const m of body.messages ?? []) {
    if (typeof m.content === 'string') { messages.push({ role: m.role, content: m.content }); continue }
    if (m.role === 'assistant') {
      // Strip the claude-switch "which provider/model answered" banner back out
      // before replaying history upstream: it's for the human, not the model,
      // and re-sending it every turn would both waste tokens and risk the
      // model imitating the tag format in its own replies.
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n').replace(BANNER_RE, '')
      const calls = m.content.filter(b => b.type === 'tool_use' && b.name).map(b => ({
        id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }))
      if (!text && !calls.length) continue
      messages.push({ role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls }) })
      continue
    }
    // user turn: tool results become `tool` messages; the rest stays one user message
    const parts = []
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        if (dropped.has(b.tool_use_id)) continue
        const content = typeof b.content === 'string' ? b.content : textOf(b.content)
        messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: (b.is_error ? 'ERROR: ' : '') + (content || '(empty)') })
      } else if (b.type === 'text') parts.push({ type: 'text', text: b.text })
      else if (b.type === 'image' && b.source?.type === 'base64') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } })
      else if (b.type === 'image' && b.source?.type === 'url') parts.push({ type: 'image_url', image_url: { url: b.source.url } })
    }
    if (parts.length) messages.push({ role: 'user', content: parts.every(p => p.type === 'text') ? parts.map(p => p.text).join('\n') : parts })
  }
  const out = { model, messages, stream: !!body.stream }
  if (body.max_tokens) out.max_tokens = body.max_tokens
  if (body.temperature != null) out.temperature = body.temperature
  if (body.stop_sequences?.length) out.stop = body.stop_sequences
  if (body.tools?.length) {
    out.tools = body.tools.filter(t => t.input_schema).map(t => ({
      type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
    }))
    const tc = body.tool_choice
    if (tc?.type === 'any') out.tool_choice = 'required'
    else if (tc?.type === 'tool') out.tool_choice = { type: 'function', function: { name: tc.name } }
    else if (tc?.type === 'none') out.tool_choice = 'none'
  }
  if (out.stream) out.stream_options = { include_usage: true }
  return out
}

const STOP = { stop: 'end_turn', length: 'max_tokens', tool_calls: 'tool_use', function_call: 'tool_use', content_filter: 'refusal' }
const parseArgs = s => { try { return JSON.parse(s || '{}') } catch { return { _raw: s } } }
const msgId = () => 'msg_free_' + Math.random().toString(36).slice(2, 14)
// With no surviving tool call, a tool_calls finish must not become tool_use.
const stopFor = (reason, hasTools) => hasTools ? "tool_use" : (STOP[reason] === "tool_use" ? "end_turn" : STOP[reason] ?? "end_turn")
const toolId = () => 'toolu_' + Math.random().toString(36).slice(2)

/** OpenAI non-stream response -> Anthropic message.
 *  `banner`, if given, is prepended as its own text block so the user can see
 *  which free provider/model answered. */
export function fromOpenAI(r, model, banner) {
  const ch = r.choices?.[0] ?? {}
  const msg = ch.message ?? {}
  const content = []
  if (banner) content.push({ type: 'text', text: banner })
  const before = content.length
  if (msg.content) content.push({ type: 'text', text: msg.content })
  const calls = (msg.tool_calls ?? []).filter(c => c.function?.name)
  for (const c of calls) content.push({ type: 'tool_use', id: c.id || toolId(), name: c.function.name, input: parseArgs(c.function.arguments) })
  // Reasoning models (e.g. stealth/space-bunny-alpha) sometimes emit only
  // `reasoning`/`reasoning_content` and leave `content` empty, which would
  // otherwise look like a silent, empty reply. Show the reasoning instead of
  // nothing.
  if (content.length === before && !calls.length) {
    const reasoning = msg.reasoning ?? msg.reasoning_content
    content.push({
      type: 'text',
      text: reasoning
        ? `(no final answer; model's reasoning follows)\n${reasoning}`
        : `(claude-switch: ${model} returned an empty reply — likely rate-limited mid-request. Try again, or run "claude-mode pick <provider> <model>" to use a different one.)`,
    })
  }
  return {
    id: msgId(), type: 'message', role: 'assistant', model, content,
    stop_reason: stopFor(ch.finish_reason, calls.length > 0), stop_sequence: null,
    usage: { input_tokens: r.usage?.prompt_tokens ?? 0, output_tokens: r.usage?.completion_tokens ?? 0 },
  }
}

/**
 * Streaming: feed raw OpenAI SSE text in, get Anthropic SSE text out.
 * Returns { push(chunkText) -> string, end() -> string }.
 * Text streams live. Tool calls are buffered and emitted whole at the end:
 * providers may send a call's id, name and arguments across separate chunks,
 * and Anthropic needs the name up front in content_block_start.
 * `banner`, if given, is emitted as its own completed text block right after
 * message_start, so the user can see which free provider/model answered.
 */
export function streamTranslator(model, banner) {
  let buf = '', started = false, block = -1, textOpen = false, gotText = false
  const tools = new Map() // openai tool index -> { id, name, args }
  let reasoning = '', finishReason = null, usage = { input_tokens: 0, output_tokens: 0 }, done = false
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
  const start = () => {
    if (started) return ''
    started = true
    let out = ev('message_start', { message: { id: msgId(), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage } })
    if (banner) {
      block++
      out += ev('content_block_start', { index: block, content_block: { type: 'text', text: '' } })
      out += ev('content_block_delta', { index: block, delta: { type: 'text_delta', text: banner } })
      out += ev('content_block_stop', { index: block })
    }
    return out
  }
  const closeText = () => { if (!textOpen) return ''; textOpen = false; return ev('content_block_stop', { index: block }) }
  function onChunk(j) {
    let out = start()
    if (j.usage) usage = { input_tokens: j.usage.prompt_tokens ?? 0, output_tokens: j.usage.completion_tokens ?? 0 }
    const ch = j.choices?.[0]
    if (!ch) return out
    const d = ch.delta ?? {}
    // Reasoning models (e.g. stealth/space-bunny-alpha) stream internal
    // "thinking" separately from `content` and occasionally never produce any
    // real content at all. Buffer it so finish() can fall back to it instead
    // of silently ending the turn with nothing.
    if (d.reasoning) reasoning += d.reasoning
    if (d.reasoning_content) reasoning += d.reasoning_content
    if (d.content) {
      gotText = true
      if (!textOpen) { block++; textOpen = true; out += ev('content_block_start', { index: block, content_block: { type: 'text', text: '' } }) }
      out += ev('content_block_delta', { index: block, delta: { type: 'text_delta', text: d.content } })
    }
    for (const tc of d.tool_calls ?? []) {
      const i = tc.index ?? 0
      const t = tools.get(i) ?? { id: '', name: '', args: '' }
      if (tc.id) t.id = tc.id
      if (tc.function?.name) t.name += tc.function.name
      if (tc.function?.arguments) t.args += tc.function.arguments
      tools.set(i, t)
    }
    if (ch.finish_reason) finishReason = ch.finish_reason
    return out
  }
  function finish() {
    if (done) return ''
    done = true
    let out = start() + closeText()
    let emitted = 0
    for (const [, t] of [...tools].sort((a, b) => a[0] - b[0])) {
      if (!t.name) continue // a nameless call would poison every later request
      block++; emitted++
      out += ev('content_block_start', { index: block, content_block: { type: 'tool_use', id: t.id || toolId(), name: t.name, input: {} } })
      out += ev('content_block_delta', { index: block, delta: { type: 'input_json_delta', partial_json: t.args || '{}' } })
      out += ev('content_block_stop', { index: block })
    }
    if (!gotText && !emitted) {
      const text = reasoning
        ? `(no final answer; model's reasoning follows)\n${reasoning}`
        : `(claude-switch: ${model} returned an empty reply — likely rate-limited mid-request. Try again, or run "claude-mode pick <provider> <model>" to use a different one.)`
      block++
      out += ev('content_block_start', { index: block, content_block: { type: 'text', text: '' } })
      out += ev('content_block_delta', { index: block, delta: { type: 'text_delta', text } })
      out += ev('content_block_stop', { index: block })
    }
    const stop = stopFor(finishReason, [...tools].some(([, t]) => t.name))
    return out + ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } }) + ev('message_stop', {})
  }
  return {
    push(text) {
      buf += text
      let out = '', i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { out += finish(); continue }
        try { out += onChunk(JSON.parse(data)) } catch { /* partial or non-JSON keepalive */ }
      }
      return out
    },
    end: finish,
    // True once real output (text, reasoning, or a named tool call) has been
    // seen — lets the caller decide whether a truly empty reply should be
    // retried on the next model/provider instead of shown to the user.
    hadContent: () => gotText || !!reasoning || [...tools.values()].some(t => t.name),
  }
}

/** Rough token estimate for /v1/messages/count_tokens when not on Anthropic. */
export function estimateTokens(body) {
  return Math.ceil(JSON.stringify([body.system, body.messages, body.tools]).length / 4)
}
