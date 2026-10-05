import { NextResponse } from 'next/server'

/**
 * A tiny page instead of a redirect: the session cookie is SameSite=strict, and a
 * redirect that began in the camera app is a cross-site navigation that would not
 * send it. A same-site navigation started by this page does.
 */
export function htmlPage(title: string, message: string, status: number, next?: string, code?: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · GhostForge</title>${next ? `<meta http-equiv="refresh" content="1;url=${esc(next)}">` : ''}
<style>body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#0B0D12;color:#E7E9EE;font:16px system-ui,sans-serif;padding:24px}main{max-width:28rem;text-align:center}h1{font-size:1.4rem}p{color:#9CA3AF}a{color:#38BDF8}button{font:inherit;font-weight:600;min-height:48px;width:100%;max-width:20rem;border:0;border-radius:12px;background:#38BDF8;color:#0B0D12;cursor:pointer;-webkit-appearance:none;appearance:none}.hint{font-size:.85rem}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(message)}</p>${code ? `<form method="post" action="/api/remote/pair/redeem"><input type="hidden" name="code" value="${esc(code)}"><button type="submit">Sign in this device</button></form>
<p class="hint">Opened inside a scanner or chat app? Open this page in your browser first (menu → Open in browser), so the sign-in stays in your browser.</p>` : ''}${next ? `<p><a href="${esc(next)}">Continue</a></p><script>setTimeout(function(){location.replace(${JSON.stringify(next)})},300)</script>` : ''}</main></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } })
}
