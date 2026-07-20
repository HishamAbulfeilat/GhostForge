import { NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { execSync } from 'child_process'

function getCPU(): number {
  try {
    const out = execSync("top -l 1 -n 0 | grep 'CPU usage'", { timeout: 3000 }).toString()
    const idle = out.match(/(\d+\.\d+)%\s+idle/)
    return idle ? Math.round(100 - parseFloat(idle[1])) : 0
  } catch { return 0 }
}

function getRAM(): { usedGB: number; totalGB: number; pct: number } {
  try {
    const out = execSync('vm_stat', { timeout: 3000 }).toString()
    const pageSize = 16384
    const get = (key: string) => {
      const m = out.match(new RegExp(`${key}:\\s+(\\d+)`))
      return m ? parseInt(m[1]) : 0
    }
    const total = execSync('sysctl -n hw.memsize', { timeout: 1000 }).toString().trim()
    const totalBytes = parseInt(total)
    const free = (get('Pages free') + get('Pages speculative')) * pageSize
    const used = totalBytes - free
    const totalGB = totalBytes / 1073741824
    const usedGB = used / 1073741824
    return { usedGB: Math.round(usedGB * 10) / 10, totalGB: Math.round(totalGB * 10) / 10, pct: Math.round((used / totalBytes) * 100) }
  } catch { return { usedGB: 0, totalGB: 0, pct: 0 } }
}

function getDisk(): { usedGB: number; totalGB: number; pct: number } {
  try {
    const out = execSync('df -k /', { timeout: 2000 }).toString()
    const line = out.split('\n')[1]
    const parts = line.trim().split(/\s+/)
    const total = parseInt(parts[1]) / 1048576
    const used = parseInt(parts[2]) / 1048576
    return { usedGB: Math.round(used * 10) / 10, totalGB: Math.round(total * 10) / 10, pct: Math.round((used / total) * 100) }
  } catch { return { usedGB: 0, totalGB: 0, pct: 0 } }
}

function getBattery(): { pct: number; charging: boolean } | null {
  try {
    const out = execSync('pmset -g batt', { timeout: 2000 }).toString()
    const pctMatch = out.match(/(\d+)%/)
    const charging = out.includes('charging') || out.includes('AC Power')
    return pctMatch ? { pct: parseInt(pctMatch[1]), charging } : null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const cookieStore = await cookies()
  const auth = cookieStore.get('gf_token')
  if (!auth?.value || auth.value !== process.env.AUTH_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let running = true
      req.signal.addEventListener('abort', () => { running = false })

      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { running = false }
      }

      while (running) {
        const [cpu, ram, disk, battery] = await Promise.all([
          Promise.resolve(getCPU()),
          Promise.resolve(getRAM()),
          Promise.resolve(getDisk()),
          Promise.resolve(getBattery()),
        ])
        send({ cpu, ram, disk, battery, ts: Date.now() })
        await new Promise(r => setTimeout(r, 4000))
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
