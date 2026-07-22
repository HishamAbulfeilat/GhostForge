import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { isAuthorizedRequest } from '@/lib/auth'

export const dynamic = 'force-dynamic'

interface JarvisMemory {
  userName: string
  preferences?: { city?: string; music?: string; language?: string }
}

const MEMORY_FILE = join(homedir(), '.ghostforge', 'jarvis', 'memory.json')

async function readMemory(): Promise<JarvisMemory | null> {
  try {
    const raw = await readFile(MEMORY_FILE, 'utf8')
    return JSON.parse(raw) as JarvisMemory
  } catch {
    return null
  }
}

async function getWeather(city: string) {
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    const data = await res.json() as {
      current_condition?: Array<{
        temp_C?: string
        FeelsLikeC?: string
        humidity?: string
        weatherDesc?: Array<{ value?: string }>
      }>
    }
    const current = data.current_condition?.[0]
    if (!current) return `${city}: weather data unavailable`
    return `${city}: ${current.weatherDesc?.[0]?.value || 'Clear'}, ${current.temp_C || '?'}°C, feels like ${current.FeelsLikeC || '?'}°C, humidity ${current.humidity || '?'}%`
  } catch {
    return `${city}: weather data unavailable`
  }
}

async function getNews(): Promise<string[]> {
  try {
    const res = await fetch('https://api.duckduckgo.com/?q=tech+news+today&format=json&pretty=1&no_html=1&skip_disambig=1', {
      signal: AbortSignal.timeout(7000),
      cache: 'no-store',
    })
    const data = await res.json() as {
      AbstractText?: string
      Heading?: string
      RelatedTopics?: Array<{ Text?: string } | { Name?: string; Topics?: Array<{ Text?: string }> }>
    }

    const items: string[] = []
    if (data.AbstractText) items.push(data.AbstractText)
    if (data.Heading && !items.some(item => item.includes(data.Heading || ''))) items.push(data.Heading)

    for (const topic of data.RelatedTopics || []) {
      if ('Text' in topic && topic.Text) items.push(topic.Text)
      if ('Topics' in topic) {
        for (const nested of topic.Topics || []) {
          if (nested.Text) items.push(nested.Text)
          if (items.length >= 4) break
        }
      }
      if (items.length >= 4) break
    }

    const cleaned = items
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((item, index, arr) => arr.indexOf(item) === index)
      .slice(0, 3)

    return cleaned.length
      ? cleaned
      : [
          'AI platforms are racing to ship more capable coding assistants this week.',
          'Cloud and chip vendors continue pushing on-device AI performance upgrades.',
          'Keep an eye on security updates in developer tooling before you start the day.',
        ]
  } catch {
    return [
      'Tech headlines are temporarily unavailable.',
      'AI tooling is still moving fast across coding, chips, and cloud.',
      'Check your trusted news feeds later for a fuller roundup.',
    ]
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const memory = await readMemory()
  const city = memory?.preferences?.city || 'Riyadh'
  const now = new Date()
  const hour = now.getHours()
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  const name = memory?.userName?.trim()

  const greeting = hour < 12
    ? `Good morning${name ? `, ${name}` : ''}. It's ${weekday}.`
    : hour < 18
      ? `Good day${name ? `, ${name}` : ''}. ${weekday} is underway.`
      : `Good evening${name ? `, ${name}` : ''}. Here's your ${weekday} rundown.`

  const advice = hour < 12
    ? 'Start with your highest-focus task before meetings take over the day.'
    : hour < 18
      ? 'Use the next block for one meaningful win, then clear your loose ends.'
      : 'Wrap with a quick recap, note tomorrow’s priority, and shut things down cleanly.'

  const [weather, news] = await Promise.all([getWeather(city), getNews()])

  return NextResponse.json({
    greeting,
    weather,
    news,
    time,
    advice,
  })
}
