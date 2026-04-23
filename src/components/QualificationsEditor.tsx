/**
 * QualificationsEditor — reusable controlled component for editing a list of
 * post-16 qualifications (A-Level, IB, BTEC, T-Level, Pre-U).
 *
 * Originally inlined in the apply form; extracted so the student hub's
 * profile edit modal can reuse the exact same UX. Kept dumb and controlled
 * — parent owns the state and validation, this component just renders.
 */
'use client'

import type { QualificationEntry } from '@/lib/apply-api'

export const QUAL_TYPES = [
  { value: 'a_level', label: 'A-Level' },
  { value: 'ib', label: 'IB (International Baccalaureate)' },
  { value: 'btec', label: 'BTEC' },
  { value: 't_level', label: 'T-Level' },
  { value: 'pre_u', label: 'Cambridge Pre-U' },
] as const

export const SUBJECTS: Record<string, string[]> = {
  a_level: [
    'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics',
    'Computer Science', 'Economics', 'Business Studies', 'Politics', 'History',
    'Geography', 'Psychology', 'Sociology', 'Religious Studies',
    'English Literature', 'English Language', 'Spanish', 'French', 'German',
    'Art/Design', 'Drama', 'Physical Education', 'Media/Film Studies',
    'Music', 'Philosophy', 'Law', 'Accounting',
  ],
  ib: [
    'Mathematics: Analysis and Approaches', 'Mathematics: Applications and Interpretation',
    'Biology', 'Chemistry', 'Physics', 'Computer Science',
    'Economics', 'Business Management', 'History', 'Geography',
    'Psychology', 'Philosophy', 'Global Politics',
    'English A: Language and Literature', 'English A: Literature',
    'Spanish B', 'French B', 'German B', 'Mandarin B',
    'Visual Arts', 'Music', 'Theatre',
    'Environmental Systems and Societies',
    'Theory of Knowledge',
  ],
  btec: [
    'Applied Science', 'Business', 'Health and Social Care', 'IT',
    'Engineering', 'Sport', 'Art and Design', 'Media',
    'Performing Arts', 'Travel and Tourism', 'Construction',
    'Computing', 'Hospitality', 'Music',
  ],
  t_level: [
    'Accounting', 'Agriculture, Land Management and Production',
    'Building Services Engineering', 'Business and Administration',
    'Catering', 'Craft and Design', 'Design and Development for Engineering',
    'Design, Surveying and Planning for Construction',
    'Digital Business Services', 'Digital Production, Design and Development',
    'Digital Support Services', 'Education and Early Years',
    'Engineering, Manufacturing, Processing and Control',
    'Finance', 'Health', 'Healthcare Science', 'Legal Services',
    'Maintenance, Installation and Repair for Engineering',
    'Management and Administration', 'Media, Broadcast and Production',
    'Onsite Construction', 'Science',
  ],
  pre_u: [
    'Mathematics', 'Further Mathematics', 'Biology', 'Chemistry', 'Physics',
    'Economics', 'History', 'Geography', 'Philosophy and Theology',
    'English Literature', 'French', 'Spanish', 'German', 'Mandarin Chinese',
    'Art and Design', 'Music', 'Global Perspectives',
  ],
}

export const GRADES: Record<string, string[]> = {
  a_level: ['A*', 'A', 'B', 'C', 'D', 'E'],
  ib: ['7', '6', '5', '4', '3', '2', '1'],
  btec: ['D* (Distinction*)', 'D (Distinction)', 'M (Merit)', 'P (Pass)'],
  t_level: ['A*', 'A', 'B', 'C', 'D', 'E'],
  pre_u: ['D1', 'D2', 'D3', 'M1', 'M2', 'M3', 'P1', 'P2', 'P3'],
}

export const IB_LEVELS = ['HL (Higher Level)', 'SL (Standard Level)']

export function emptyQualification(): QualificationEntry {
  return { qualType: 'a_level', subject: '', grade: '' }
}

// Most UK students do 3 A-levels, so both the hub profile editor and the
// apply form seed the editor with 3 empty rows. Change this constant and
// both surfaces update in lockstep.
export const DEFAULT_QUALIFICATION_ROW_COUNT = 3

export function defaultQualifications(): QualificationEntry[] {
  return Array.from({ length: DEFAULT_QUALIFICATION_ROW_COUNT }, emptyQualification)
}

type Props = {
  value: QualificationEntry[]
  onChange: (next: QualificationEntry[]) => void
  /** Optional error string displayed under the field. */
  error?: string | null
  /** Optional callback invoked whenever the user interacts; lets parents clear their own error state. */
  onInteract?: () => void
  /** Allow fully empty list (no "add another" auto-spawn). Default: require at least one row. */
  allowEmpty?: boolean
}

export default function QualificationsEditor({ value, onChange, error, onInteract, allowEmpty = false }: Props) {
  const items = value.length === 0 && !allowEmpty ? [emptyQualification()] : value

  const update = (idx: number, field: keyof QualificationEntry, val: string) => {
    onInteract?.()
    const next = items.map((q, i) => {
      if (i !== idx) return q
      // Reset subject and grade if qualType changes (different menus)
      if (field === 'qualType') {
        return { ...q, qualType: val, subject: '', grade: '', level: q.qualType === 'ib' ? q.level : undefined }
      }
      return { ...q, [field]: val }
    })
    onChange(next)
  }

  const remove = (idx: number) => {
    onInteract?.()
    const next = items.filter((_, i) => i !== idx)
    onChange(next.length === 0 && !allowEmpty ? [emptyQualification()] : next)
  }

  const add = () => {
    onInteract?.()
    onChange([...items, emptyQualification()])
  }

  return (
    <div>
      <div className="space-y-3">
        {items.map((q, idx) => (
          <div key={idx} className="p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-500">Subject {idx + 1}</span>
              {items.length > 1 && (
                <button type="button" onClick={() => remove(idx)}
                  className="text-xs text-red-400 hover:text-red-600 font-medium">Remove</button>
              )}
            </div>

            <select value={q.qualType}
              onChange={e => update(idx, 'qualType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition mb-2">
              {QUAL_TYPES.map(qt => (
                <option key={qt.value} value={qt.value}>{qt.label}</option>
              ))}
            </select>

            <div className={`grid gap-2 ${q.qualType === 'ib' ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <select value={q.subject}
                onChange={e => update(idx, 'subject', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                <option value="">Select subject…</option>
                {(SUBJECTS[q.qualType] ?? []).map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
                <option value="__other">Other (not listed)</option>
              </select>

              {q.qualType === 'ib' && (
                <select value={q.level ?? ''}
                  onChange={e => update(idx, 'level', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                  <option value="">Level…</option>
                  {IB_LEVELS.map(l => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              )}

              <select value={q.grade}
                onChange={e => update(idx, 'grade', e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition">
                <option value="">Grade…</option>
                {(GRADES[q.qualType] ?? []).map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {q.subject === '__other' && (
              <input type="text" placeholder="Type your subject name…"
                className="w-full mt-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-steps-blue-500 focus:border-transparent outline-none transition"
                onChange={e => {
                  onInteract?.()
                  const val = e.target.value
                  onChange(items.map((qq, i) =>
                    i === idx ? { ...qq, subject: val || '__other' } : qq
                  ))
                }}
              />
            )}
          </div>
        ))}
      </div>

      <button type="button" onClick={add}
        className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm text-steps-blue-600 font-medium hover:border-steps-blue-300 hover:bg-steps-blue-50 transition">
        + Add another subject
      </button>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}
