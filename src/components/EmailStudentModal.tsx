'use client'
import { useCallback, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  RichTextEmailEditor,
  type RichTextEmailEditorHandle,
  SingleLineMergeEditor,
  type SingleLineMergeEditorHandle,
  type MergeTag,
  plainTextToHtml,
  looksLikeHtml,
  type EmailAttachmentInfo,
} from './RichTextEmailEditor'
import { EMAIL_SIGNATURE_HTML, EmailPreviewPanel } from './EmailComposePanels'

// ---------------------------------------------------------------------------
// EmailStudentModal — one-off email to a single student, ad-hoc / non-event.
//
// Wires to /api/send-email (same route InviteStudentsModal uses) so the email
// inherits the standard hello@ signature, List-Unsubscribe header, unsubscribe
// footer link, mailing-list guard, and 24h marketing cap. No eventId is sent
// so the per-event opt-out skip doesn't apply — this is a 1:1 from the admin,
// not a campaign about a specific event.
//
// Logged in email_log just like bulk sends, so the timeline on /students/[id]
// surfaces this alongside campaign emails.
// ---------------------------------------------------------------------------

type Props = {
  studentId: string
  studentEmail: string
  studentFirstName: string | null
  studentLastName: string | null
  preferredName?: string | null
  teamMemberUuid: string | null
  onClose: () => void
  onSent?: () => void
}

type Step = 'compose' | 'preview' | 'sending' | 'done'

export default function EmailStudentModal({ studentId, studentEmail, studentFirstName, studentLastName, preferredName, teamMemberUuid, onClose, onSent }: Props) {
  const [step, setStep] = useState<Step>('compose')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [attachments, setAttachments] = useState<EmailAttachmentInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const subjectRef = useRef<SingleLineMergeEditorHandle | null>(null)
  const bodyRef = useRef<RichTextEmailEditorHandle | null>(null)

  const firstName = (preferredName && preferredName.trim()) ? preferredName : (studentFirstName ?? '')
  const lastName = studentLastName ?? ''
  const fullName = `${firstName} ${lastName}`.trim() || studentEmail

  const mergeTags: MergeTag[] = [
    { tag: 'first_name', label: 'First Name' },
    { tag: 'last_name', label: 'Last Name' },
    { tag: 'full_name', label: 'Full Name' },
    { tag: 'email', label: 'Email' },
  ]
  const subjectTags = mergeTags.filter(t => ['first_name', 'full_name'].includes(t.tag))

  const fillMerge = useCallback((text: string): string => {
    return text
      .replace(/\{\{first_name\}\}/g, firstName)
      .replace(/\{\{last_name\}\}/g, lastName)
      .replace(/\{\{full_name\}\}/g, fullName)
      .replace(/\{\{email\}\}/g, studentEmail)
      .replace(/\{\{[a-z_0-9]+\}\}/g, '')
  }, [firstName, lastName, fullName, studentEmail])

  const canPreview = subject.trim().length > 0 && body.trim().length > 0

  const send = async () => {
    if (submittingRef.current) return
    if (!canPreview) {
      setError('Subject and body are both required.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError(null)
    setStep('sending')

    const renderedSubject = fillMerge(subject)
    const renderedBody = fillMerge(body)
    const bodyHtml = looksLikeHtml(renderedBody) ? renderedBody : plainTextToHtml(renderedBody)
    const fullBody = bodyHtml + EMAIL_SIGNATURE_HTML

    // Pre-write the log row so the activity timeline shows the attempt
    // even if the network round-trip fails. Mirror InviteStudentsModal.
    let emailLogId: string | null = null
    try {
      const { data: logRow } = await supabase.from('email_log').insert({
        student_id: studentId,
        event_id: null,
        template_id: null,
        to_email: studentEmail,
        from_email: 'events@thestepsfoundation.com',
        subject: renderedSubject,
        body_html: fullBody,
        status: 'pending',
        sent_by: teamMemberUuid,
      }).select('id').single()
      emailLogId = logRow?.id ?? null
    } catch { /* log is best-effort */ }

    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: studentEmail,
          subject: renderedSubject,
          html: fullBody,
          attachments,
          studentId,
          // No eventId — this is a general 1:1 admin email, not an
          // event-specific campaign. The per-event opt-out skip doesn't apply.
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        const msg = j?.error || `HTTP ${res.status}`
        if (emailLogId) {
          await supabase.from('email_log').update({ status: 'failed', error_message: msg }).eq('id', emailLogId)
        }
        setError(msg)
        setStep('compose')
        submittingRef.current = false
        setSubmitting(false)
        return
      }
      if (emailLogId) {
        await supabase.from('email_log').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', emailLogId)
      }
      onSent?.()
      setStep('done')
    } catch (e: any) {
      const msg = e?.message ?? 'Send failed'
      if (emailLogId) {
        await supabase.from('email_log').update({ status: 'failed', error_message: msg }).eq('id', emailLogId)
      }
      setError(msg)
      setStep('compose')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Email student" className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-stretch justify-center p-4 sm:p-6">
      <div className="w-full max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-gray-800 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 dark:border-gray-800">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] font-bold text-slate-500">Email student</p>
            <p className="text-sm font-semibold text-steps-dark dark:text-gray-100 mt-0.5 truncate">To: {fullName} &lt;{studentEmail}&gt;</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {step === 'compose' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-gray-400 mb-1">Subject</label>
                <SingleLineMergeEditor
                  ref={subjectRef}
                  value={subject}
                  onChange={setSubject}
                  placeholder="e.g. Following up on your application"
                />
                <div className="mt-1 flex flex-wrap gap-1 items-center">
                  <span className="text-[11px] text-slate-500">Insert:</span>
                  {subjectTags.map(t => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => subjectRef.current?.insertMergeTag(t.tag, t.label)}
                      className="text-[11px] px-1.5 py-0.5 rounded-full border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-slate-100"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-gray-400 mb-1">Body</label>
                <RichTextEmailEditor
                  ref={bodyRef}
                  initialHtml={body}
                  onChange={setBody}
                  placeholder={`Hi {{first_name}},\n\n...\n\nBest wishes,\nThe Steps Foundation Team`}
                  attachments={attachments}
                  onAttach={att => setAttachments(prev => prev.some(p => p.url === att.url) ? prev : [...prev, att])}
                  onRemoveAttachment={url => setAttachments(prev => prev.filter(p => p.url !== url))}
                />
                <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-slate-500">Insert:</span>
                  {mergeTags.map(t => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => bodyRef.current?.insertMergeTag(t.tag, t.label)}
                      className="text-xs px-2 py-0.5 rounded-full border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-700 dark:text-gray-300 hover:bg-slate-100"
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              {error && (
                <div role="alert" className="text-xs text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 rounded-lg px-3 py-2">{error}</div>
              )}
            </div>
          )}
          {step === 'preview' && (
            <EmailPreviewPanel
              recipientName={fullName}
              recipientEmail={studentEmail}
              filledSubject={fillMerge(subject)}
              filledBodyHtml={(() => {
                const filled = fillMerge(body)
                return looksLikeHtml(filled) ? filled : plainTextToHtml(filled)
              })()}
            />
          )}
          {step === 'sending' && (
            <div className="py-10 text-center text-slate-600 dark:text-gray-400">Sending…</div>
          )}
          {step === 'done' && (
            <div className="py-10 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center mb-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-semibold text-steps-dark dark:text-gray-100">Email sent</p>
              <p className="text-xs text-slate-500 mt-1">Logged in the activity timeline for {fullName}.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 dark:border-gray-800">
          {step === 'compose' && (
            <>
              <button onClick={onClose} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">Cancel</button>
              <button onClick={() => setStep('preview')} disabled={!canPreview} className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50">Preview</button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button onClick={() => setStep('compose')} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800">Back</button>
              <button onClick={send} disabled={submitting} className="px-4 py-1.5 text-sm rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60">{submitting ? 'Sending…' : 'Send'}</button>
            </>
          )}
          {step === 'done' && (
            <button onClick={onClose} className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700">Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
