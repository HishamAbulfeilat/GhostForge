import { NextRequest } from 'next/server'
import { isAuthorizedRequest } from '@/lib/auth'
import { getCPU, getRAM, getDisk, getBattery, type MetricStat, type BatteryStat } from '@/lib/system-info'

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
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
