'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTime, JOB_STATUS_META } from '@/lib/dashboard/format'
import type { JobRequestRow, JobLogRow, PressReleaseRow } from '@/lib/dashboard/queries'
import PersberichtView from './PersberichtView'

interface Props {
  signalId: number
  initialJob: JobRequestRow | null
  initialLogs: JobLogRow[]
  initialPressRelease: PressReleaseRow | null
}

const POLL_MS = 5000

export default function PersberichtQueue({ signalId, initialJob, initialLogs, initialPressRelease }: Props) {
  const [job, setJob] = useState(initialJob)
  const [logs, setLogs] = useState(initialLogs)
  const [pressRelease, setPressRelease] = useState(initialPressRelease)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const jobIdRef = useRef<number | null>(initialJob?.id ?? null)

  const isOpen = job?.status === 'queued' || job?.status === 'running'

  useEffect(() => {
    jobIdRef.current = job?.id ?? null
  }, [job?.id])

  useEffect(() => {
    if (!isOpen || !job) return

    const poll = async () => {
      try {
        const res = await fetch(`/api/dashboard/jobs/${job.id}`)
        if (!res.ok) return
        const data = await res.json()
        if (jobIdRef.current !== job.id) return
        setJob(data.job)
        setLogs(data.logs ?? [])
        setPressRelease(data.pressRelease ?? null)
      } catch {
        // netwerkhapering — probeer het bij de volgende poll gewoon opnieuw
      }
    }

    const interval = setInterval(poll, POLL_MS)
    return () => clearInterval(interval)
  }, [isOpen, job])

  const handleCreate = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/dashboard/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Aanvragen mislukt')
      }
      const data = await res.json()
      setJob(data.job)
      setLogs([])
      setPressRelease(null)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Aanvragen mislukt')
    } finally {
      setCreating(false)
    }
  }

  if (!job) {
    return (
      <div className="dash-pr-queue">
        <button className="btn btn-primary" onClick={handleCreate} disabled={creating} type="button">
          {creating ? 'Aanvragen...' : 'Laat uitwerken tot persbericht'}
        </button>
        {createError && <p className="dash-pr-error">{createError}</p>}
      </div>
    )
  }

  if (job.status === 'queued') {
    return (
      <div className="dash-pr-queue">
        <span className="dash-pill" style={{ background: `${JOB_STATUS_META.queued.color}22`, color: JOB_STATUS_META.queued.color }}>
          {JOB_STATUS_META.queued.label}
        </span>
        <p className="dash-job-status">
          Aangevraagd om {formatTime(job.requested_at)} — wacht op de redactieassistent.
          Die komt elk half uur langs, tussen 08:00 en 20:00.
        </p>
      </div>
    )
  }

  if (job.status === 'running') {
    return (
      <div className="dash-pr-queue">
        <span className="dash-pill" style={{ background: `${JOB_STATUS_META.running.color}22`, color: JOB_STATUS_META.running.color }}>
          {JOB_STATUS_META.running.label}
        </span>
        {logs.length === 0 ? (
          <p className="dash-job-status">De redactieassistent is gestart, nog geen regels ontvangen.</p>
        ) : (
          <ul className="dash-joblog">
            {logs.map((l) => (
              <li key={l.id} className="dash-joblog-line">
                <span className="dash-joblog-time">{formatTime(l.ts)}</span>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (job.status === 'done') {
    return pressRelease ? (
      <PersberichtView pressRelease={pressRelease} />
    ) : (
      <div className="dash-pr-queue">
        <span className="dash-pill" style={{ background: `${JOB_STATUS_META.done.color}22`, color: JOB_STATUS_META.done.color }}>
          {JOB_STATUS_META.done.label}
        </span>
        <p className="dash-job-status">Job is afgerond, maar het persbericht kon niet worden gevonden.</p>
      </div>
    )
  }

  // status === 'error' (of onbekend) — foutmelding tonen, knop weer beschikbaar
  return (
    <div className="dash-pr-queue">
      <span className="dash-pill" style={{ background: `${JOB_STATUS_META.error.color}22`, color: JOB_STATUS_META.error.color }}>
        {JOB_STATUS_META[job.status]?.label || job.status}
      </span>
      <p className="dash-job-status">{job.error_message || 'Er ging iets mis bij het uitwerken.'}</p>
      <button className="btn btn-primary" onClick={handleCreate} disabled={creating} type="button">
        {creating ? 'Aanvragen...' : 'Opnieuw proberen'}
      </button>
      {createError && <p className="dash-pr-error">{createError}</p>}
    </div>
  )
}
