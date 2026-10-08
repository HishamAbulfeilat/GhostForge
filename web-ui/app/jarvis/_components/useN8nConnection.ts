'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export interface N8nWorkflow { id: string; name: string; active: boolean; trigger: string }

export interface N8nConnection {
  n8nConnected: boolean
  setN8nConnected: Dispatch<SetStateAction<boolean>>
  n8nUrl: string
  setN8nUrl: Dispatch<SetStateAction<string>>
  n8nUrlTouched: boolean
  setN8nUrlTouched: Dispatch<SetStateAction<boolean>>
  n8nWorkflows: N8nWorkflow[]
  setN8nWorkflows: Dispatch<SetStateAction<N8nWorkflow[]>>
}

/**
 * n8n connection state shared by the SYSTEMS column and the settings panel.
 * Reads the initial status from the Electron bridge when it exists.
 */
export function useN8nConnection(): N8nConnection {
  const [n8nConnected, setN8nConnected] = useState(false)
  const [n8nUrl, setN8nUrl] = useState('http://localhost:5678')
  const [n8nUrlTouched, setN8nUrlTouched] = useState(false)
  const [n8nWorkflows, setN8nWorkflows] = useState<N8nWorkflow[]>([])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electron?.n8n
    if (!api) return
    api.getStatus().then((res: { connected: boolean; url: string }) => {
      setN8nConnected(res.connected)
      if (res.url) setN8nUrl(res.url)
      if (res.connected) {
        api.listWorkflows().then((wfs: N8nWorkflow[]) => {
          setN8nWorkflows(wfs)
        }).catch(() => {})
      }
    }).catch(() => {})
  }, [])

  return { n8nConnected, setN8nConnected, n8nUrl, setN8nUrl, n8nUrlTouched, setN8nUrlTouched, n8nWorkflows, setN8nWorkflows }
}
