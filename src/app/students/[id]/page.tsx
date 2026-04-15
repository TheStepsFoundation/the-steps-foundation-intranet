'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { EVENTS, StudentRow, ApplicationRow, fetchStudent, enrich } from '@/lib/students-api'

export default function StudentProfilePage({ params }: { params: { id: string } }) {
  const { id } = params
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [apps, setApps] = useState<ApplicationRow[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchStudent(id)
      .then(({ student, applications }) => {
        if (!active) return
        setStudent(student)
        setApps(applications)
        setLoading(false)
      })
      .catch(err => {
        if (!active) return
        setError(err?.message ?? 'Failed to load')
        setLoading(false)
      })
    return () => { active = false }
  }, [id])

  if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Loading…</div>
  if (error) return <div className="max-w-5xl mx-auto p-8 text-red-600">{error}</div>
  if (!student) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Student not found.</div>

  const enriched = enrich(student, apps.map(a => ({ ...a, student_id: student.id })))
  const fullName = `${student.first_name || ''} ${student.last_name || ''}`.trim() || student.personal_email || 'Unnamed'

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/students" className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">← All students</Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">{fullName}</h1>
          <div className="mt-1 text-sm text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
            {student.personal_email && <span>{student.personal_email}</span>}
            {student.school_name_raw && <span>{student.school_name_raw}</span>}
            {student.year_group && <span>{student.year_group}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <Badge label={`${enriched.attended_count} attended`} tone="emerald" />
          {enriched.no_show_count > 0 && <Badge label={`${enriched.no_show_count} no-show`} tone="amber" />}
          <Badge label={`Score ${enriched.engagement_score}`} tone="indigo" />
        </div>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-2 mb-6">
        {student.free_school_meals && <Flag>Free school meals</Flag>}
        {student.first_generation_uni && <Flag>First-gen uni</Flag>}
        {student.parental_income_band && <Flag>Income: {student.parental_income_band}</Flag>}
        {student.subscribed_to_mailing ? <Flag tone="green">On mailing list</Flag> : <Flag tone="gray">Not subscribed</Flag>}
      </div>

      {/* Event history */}
      <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-medium text-gray-900 dark:text-gray-100">Event history</h2>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400">
            <tr>
              <Th>Event</Th>
              <Th>Date</Th>
              <Th>Status</Th>
              <Th>Attended</Th>
              <Th>Submitted</Th>
              <Th>Source</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {EVENTS.map(e => {
              const app = apps.find(a => a.event_id === e.id)
              return (
                <tr key={e.id}>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{e.name}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{e.date}</td>
                  <td className="px-3 py-2">{app ? <StatusPill status={app.status} /> : <span className="text-gray-300 dark:text-gray-700">—</span>}</td>
                  <td className="px-3 py-2">{app?.attended ? '✓' : app ? '—' : ''}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{app?.submitted_at ? new Date(app.submitted_at).toLocaleDateString() : ''}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{app?.attribution_source || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {student.notes && (
        <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <h2 className="font-medium text-gray-900 dark:text-gray-100 mb-2">Notes</h2>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{student.notes}</p>
        </section>
      )}
    </main>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide">{children}</th>
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    rejected: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    submitted: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    waitlist: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    withdrew: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500',
    shortlisted: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${map[status] || 'bg-gray-100 text-gray-600'}`}>{status}</span>
}

function Badge({ label, tone }: { label: string; tone: 'emerald' | 'amber' | 'indigo' }) {
  const map = {
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  }
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${map[tone]}`}>{label}</span>
}

function Flag({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'gray' }) {
  const map = {
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-200/60 dark:border-blue-900/40',
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-900/40',
    gray: 'bg-gray-50 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  }
  return <span className={`px-2.5 py-1 rounded-md text-xs border ${map[tone]}`}>{children}</span>
}
