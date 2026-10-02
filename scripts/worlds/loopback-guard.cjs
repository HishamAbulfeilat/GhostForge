'use strict'
// Preloaded (NODE_OPTIONS=--require) into every world child process so servers
// that would otherwise bind 0.0.0.0 (e.g. Colyseus) listen on loopback only.
const net = require('node:net')

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])
const original = net.Server.prototype.listen

net.Server.prototype.listen = function listen(...args) {
  const first = args[0]
  if (first && typeof first === 'object') {
    if (first.path) return original.apply(this, args)
    if (first.host && !LOOPBACK.has(first.host)) throw new Error(`refusing non-loopback bind: ${first.host}`)
    return original.call(this, { ...first, host: first.host || '127.0.0.1' }, ...args.slice(1))
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    const rest = args.slice(1)
    if (typeof rest[0] === 'string') {
      if (!LOOPBACK.has(rest[0])) throw new Error(`refusing non-loopback bind: ${rest[0]}`)
      return original.apply(this, args)
    }
    return original.call(this, Number(first), '127.0.0.1', ...rest)
  }
  return original.apply(this, args)
}
