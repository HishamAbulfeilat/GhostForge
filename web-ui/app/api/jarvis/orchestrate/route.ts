import { NextRequest, NextResponse } from 'next/server'

interface SubTask {
  id: string
  label: string
  prompt: string
}

interface OrchestrationRequest {
  task: string
  subtasks?: SubTask[]
}

interface OrchestrationResult {
  id: string
  label: string
  response: string
  duration: number
  error?: string
}

interface JarvisResponse {
  response?: string
  content?: string
}

export async function POST(req: NextRequest) {
  const { task, subtasks }: OrchestrationRequest = await req.json()

  const tasks: SubTask[] = subtasks?.length ? subtasks : autoDecompose(task)
  const startTime = Date.now()
  const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin || 'http://localhost:3001'

  const results: OrchestrationResult[] = await Promise.all(
    tasks.map(async (st): Promise<OrchestrationResult> => {
      const t0 = Date.now()
      try {
        const resp = await fetch(`${baseUrl}/api/jarvis`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: req.headers.get('cookie') || 'gf_token=2001',
          },
          body: JSON.stringify({ message: st.prompt, stream: false }),
          signal: AbortSignal.timeout(30000),
        })
        const data = (await resp.json()) as JarvisResponse
        return {
          id: st.id,
          label: st.label,
          response: data.response || data.content || JSON.stringify(data),
          duration: Date.now() - t0,
        }
      } catch (error: unknown) {
        return {
          id: st.id,
          label: st.label,
          response: '',
          duration: Date.now() - t0,
          error: error instanceof Error ? error.message : 'Unknown orchestration error',
        }
      }
    })
  )

  const merged = results
    .map(result => `### ${result.label}\n${result.error ? `Error: ${result.error}` : result.response}`)
    .join('\n\n')

  return NextResponse.json({
    task,
    subtasks: results,
    merged,
    totalDuration: Date.now() - startTime,
  })
}

function autoDecompose(task: string): SubTask[] {
  return [
    { id: 'analysis', label: 'Analysis', prompt: `Analyze this task from a technical perspective: ${task}` },
    { id: 'implementation', label: 'Implementation Plan', prompt: `Create a step-by-step implementation plan for: ${task}` },
    { id: 'risks', label: 'Risks & Considerations', prompt: `What are the risks and edge cases for: ${task}` },
  ]
}
