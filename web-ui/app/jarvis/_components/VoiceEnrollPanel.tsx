'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ── Voice Enrollment Panel ────────────────────────────────────────────────────

export default function VoiceEnrollPanel({ mc }: { mc: { ring: string } }) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'uploading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [enrolled, setEnrolled] = useState(false)
  const [reEnrollMode, setReEnrollMode] = useState(false)
  const [savedIdentity, setSavedIdentity] = useState<{ name: string; dob: string } | null>(null)
  const [enrollName, setEnrollName] = useState('')
  const [enrollDob, setEnrollDob] = useState('')
  const [enrollKeyword, setEnrollKeyword] = useState('')
  const [audioBase64, setAudioBase64] = useState('')
  const [verifyName, setVerifyName] = useState('')
  const [verifyDob, setVerifyDob] = useState('')
  const [verifyKeyword, setVerifyKeyword] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'pass' | 'fail'>('idle')
  const [verifyMessage, setVerifyMessage] = useState('')
  const mediaRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isEnrolled = localStorage.getItem('gf_enrolled') === 'true'
    const rawIdentity = localStorage.getItem('gf_identity')
    let identity: { name: string; dob: string } | null = null

    if (rawIdentity) {
      try {
        const parsed = JSON.parse(rawIdentity) as { name?: string; dob?: string }
        identity = { name: parsed.name || '', dob: parsed.dob || '' }
      } catch {
        identity = null
      }
    }

    setEnrolled(isEnrolled)
    setSavedIdentity(identity)
    setEnrollName(identity?.name || '')
    setEnrollDob(identity?.dob || '')
    setVerifyName(identity?.name || '')
    setVerifyDob(identity?.dob || '')

    return () => {
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
      if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
      streamRef.current?.getTracks().forEach(track => track.stop())
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }, [])

  const showEnrollForm = !enrolled || reEnrollMode
  const canRecord = Boolean(enrollName.trim() && enrollDob.trim() && enrollKeyword.trim())
  const canEnroll = Boolean(canRecord && audioBase64 && status !== 'uploading' && status !== 'recording')

  const startEnroll = async () => {
    try {
      setAudioBase64('')
      setMessage('')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' })
      mediaRef.current = rec
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
        stopStream()
        if (!chunksRef.current.length) {
          setStatus('error')
          setMessage('No audio captured — please try again.')
          return
        }

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => {
              const result = typeof reader.result === 'string' ? reader.result.split(',')[1] || '' : ''
              resolve(result)
            }
            reader.onerror = () => reject(new Error('Failed to read audio sample'))
            reader.readAsDataURL(blob)
          })
          setAudioBase64(base64)
          setStatus('idle')
          setMessage('Voice sample recorded. Ready to enroll.')
        } catch (error) {
          setStatus('error')
          setMessage((error as Error).message || 'Failed to prepare audio sample.')
        }
      }
      rec.start(1000)
      setStatus('recording')
      setMessage('Speak naturally — say your name and a phrase.')
      stopTimerRef.current = setTimeout(() => {
        if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
      }, 8_000)
    } catch (e) {
      setStatus('error')
      const msg = (e as Error).message || ''
      setMessage(msg.includes('NotAllowed') || msg.includes('Permission') ? 'Microphone access denied — allow in browser settings' : `Recording error: ${msg}`)
    }
  }

  const stopEarly = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current)
    if (mediaRef.current?.state === 'recording') mediaRef.current.stop()
  }

  const submitEnroll = async () => {
    if (!canEnroll) return

    setStatus('uploading')
    setMessage('Saving voice profile…')
    try {
      const res = await fetch('/api/jarvis/biometrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'enroll-voice',
          audio: audioBase64,
          name: enrollName.trim(),
          dob: enrollDob.trim(),
          keyword: enrollKeyword.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
        setStatus('error')
        setMessage(data.error || data.message || 'Enrollment failed — try again.')
        return
      }
      const data = await res.json() as { success?: boolean; error?: string; message?: string }
      if (!data.success) {
        setStatus('error')
        setMessage(data.error || data.message || 'Enrollment failed — try again.')
        return
      }

      const identity = { name: enrollName.trim(), dob: enrollDob.trim() }
      if (typeof window !== 'undefined') {
        localStorage.setItem('gf_enrolled', 'true')
        localStorage.setItem('gf_identity', JSON.stringify(identity))
      }
      setSavedIdentity(identity)
      setEnrolled(true)
      setReEnrollMode(false)
      setVerifyName(identity.name)
      setVerifyDob(identity.dob)
      setStatus('done')
      setMessage('✓ Voice profile saved. JARVIS knows who you are.')
    } catch {
      setStatus('error')
      setMessage('Enrollment failed — check connection and try again.')
    }
  }

  const submitVerify = async () => {
    if (!verifyName.trim() || !verifyDob.trim() || !verifyKeyword.trim()) return

    setVerifyStatus('checking')
    setVerifyMessage('Verifying identity…')
    try {
      const res = await fetch('/api/jarvis/biometrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'identity-challenge',
          name: verifyName.trim(),
          dob: verifyDob.trim(),
          keyword: verifyKeyword.trim(),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string; error?: string }
        setVerifyStatus('fail')
        setVerifyMessage(data.message || data.error || 'Identity verification failed.')
        return
      }
      const data = await res.json() as { verified?: boolean; message?: string; error?: string }
      const verified = Boolean(res.ok && data.verified)
      setVerifyStatus(verified ? 'pass' : 'fail')
      setVerifyMessage(data.message || data.error || (verified ? '✓ Identity verified.' : 'Identity verification failed.'))
    } catch {
      setVerifyStatus('fail')
      setVerifyMessage('Identity verification failed — try again.')
    }
  }

  return (
    <div className="min-w-[220px]">
      <p className="text-blue-400/40 tracking-widest mb-1.5">VOICE BIOMETRICS</p>
      <p className="text-[9px] text-blue-400/30 mb-2 leading-relaxed">
        Enroll your voice so JARVIS can verify your identity and lock out imposters.
      </p>

      <div className="space-y-3">
        <div className="rounded border p-2" style={{ borderColor: `${mc.ring}33`, background: 'rgba(0,0,0,0.18)' }}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[10px] tracking-widest text-blue-400/45">VOICE ENROLLMENT</p>
            {enrolled && !reEnrollMode && (
              <div className="flex items-center gap-2 text-[9px]">
                <span style={{ color: '#00ff88' }}>✓ Enrolled as {savedIdentity?.name || 'saved profile'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setReEnrollMode(true)
                    setStatus('idle')
                    setMessage('')
                    setAudioBase64('')
                  }}
                  className="underline underline-offset-2 transition"
                  style={{ color: `${mc.ring}bb` }}>
                  Re-enroll
                </button>
              </div>
            )}
          </div>

          {showEnrollForm && (
            <div className="space-y-2">
              <div className="grid gap-1.5">
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Full name</span>
                  <input
                    type="text"
                    value={enrollName}
                    onChange={e => setEnrollName(e.target.value)}
                    placeholder="Full name"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Date of birth</span>
                  <input
                    type="text"
                    value={enrollDob}
                    onChange={e => setEnrollDob(e.target.value)}
                    placeholder="e.g. 14 July 1990"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
                <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
                  <span>Personal keyword / phrase</span>
                  <input
                    type="text"
                    value={enrollKeyword}
                    onChange={e => setEnrollKeyword(e.target.value)}
                    placeholder="e.g. ghostforge"
                    className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                    style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {canRecord ? (
                  status === 'recording' ? (
                    <>
                      <button
                        type="button"
                        onClick={stopEarly}
                        className="rounded px-2 py-1 border transition text-[10px] animate-pulse"
                        style={{ borderColor: '#ff4444', color: '#ff4444', background: 'rgba(255,68,68,0.1)' }}>
                        ⏹ STOP RECORDING
                      </button>
                      <span className="text-[9px] text-red-400/60 animate-pulse">● REC</span>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startEnroll()}
                      disabled={status === 'uploading'}
                      className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
                      style={{ borderColor: `${mc.ring}66`, color: mc.ring, background: `${mc.ring}12` }}>
                      🎙 RECORD VOICE
                    </button>
                  )
                ) : (
                  <span className="text-[9px] text-blue-400/30">Fill out all fields to unlock voice recording.</span>
                )}

                <button
                  type="button"
                  onClick={() => void submitEnroll()}
                  disabled={!canEnroll}
                  className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
                  style={{ borderColor: `${mc.ring}66`, color: canEnroll ? mc.ring : `${mc.ring}88`, background: `${mc.ring}12` }}>
                  {status === 'uploading' ? 'ENROLLING…' : 'ENROLL'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded border p-2" style={{ borderColor: `${mc.ring}22`, background: 'rgba(0,0,0,0.14)' }}>
          <p className="mb-2 text-[10px] tracking-widest text-blue-400/45">ID VERIFY</p>
          <div className="grid gap-1.5">
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Full name</span>
              <input
                type="text"
                value={verifyName}
                onChange={e => setVerifyName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Date of birth</span>
              <input
                type="text"
                value={verifyDob}
                onChange={e => setVerifyDob(e.target.value)}
                placeholder="e.g. 14 July 1990"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
            <label className="grid gap-1 text-[9px]" style={{ color: `${mc.ring}aa` }}>
              <span>Security phrase</span>
              <input
                type="text"
                value={verifyKeyword}
                onChange={e => setVerifyKeyword(e.target.value)}
                placeholder="e.g. ghostforge"
                className="w-full rounded px-2 py-1 text-[10px] bg-black/40 border outline-none"
                style={{ borderColor: `${mc.ring}44`, color: mc.ring }}
              />
            </label>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void submitVerify()}
              disabled={!verifyName.trim() || !verifyDob.trim() || !verifyKeyword.trim() || verifyStatus === 'checking'}
              className="rounded px-2 py-1 border transition text-[10px] disabled:opacity-40"
              style={{ borderColor: `${mc.ring}44`, color: mc.ring, background: 'transparent' }}>
              {verifyStatus === 'checking' ? 'VERIFYING…' : 'VERIFY IDENTITY'}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <p className="mt-1 text-[9px] leading-relaxed" style={{ color: status === 'done' ? '#00ff88' : status === 'error' ? '#ff6666' : `${mc.ring}99` }}>
          {message}
        </p>
      )}
      {verifyMessage && (
        <p className="mt-1 text-[9px] leading-relaxed" style={{ color: verifyStatus === 'pass' ? '#00ff88' : verifyStatus === 'fail' ? '#ff6666' : `${mc.ring}99` }}>
          {verifyMessage}
        </p>
      )}
    </div>
  )
}
