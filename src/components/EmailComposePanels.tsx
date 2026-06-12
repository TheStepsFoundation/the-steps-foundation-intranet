'use client'
/**
 * Shared panels for the two email-compose flows:
 *   - InviteStudentsModal (one-by-one /api/send-email)
 *   - events/[id] decision notify (bulk queue insert)
 *
 * Keeping the markup for compose / preview / sending / done in ONE place means
 * future formatting changes (classNames, copy, structure) propagate to both
 * flows without a cross-file diff. Flow-specific logic (send model, status
 * updates, abort semantics) lives in the parent and is wired in via props.
 */
import { wrapHtmlForEmail } from '@/lib/email-mime'
import { type ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  RichTextEmailEditor,
  type RichTextEmailEditorHandle,
  SingleLineMergeEditor,
  type SingleLineMergeEditorHandle,
  MergeTagInsertBar,
  DEFAULT_MERGE_TAGS,
  type MergeTag,
  type EmailAttachmentInfo,
} from './RichTextEmailEditor'

// ---------------------------------------------------------------------------
// Shared signature HTML — matches the real events@ Gmail signature. Exported
// so parents can prepend it to outgoing bodies with the exact same bytes we
// render in the preview / signature-strip.
// ---------------------------------------------------------------------------
export const EMAIL_SIGNATURE_HTML = `
<br>
<table style="color:rgb(34,34,34);direction:ltr;border-collapse:collapse">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:508px">
<tbody><tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;line-height:1.15;color:rgb(0,0,0)">
<tbody><tr>
<td style="vertical-align:top;padding:0.01px 14px 0.01px 1px;width:65px;text-align:center">
<img width="96" height="96" src="https://the-steps-foundation-intranet.vercel.app/tsf-logo.png" alt="The Steps Foundation">
</td>
<td valign="top" style="padding:0.01px 0.01px 0.01px 14px;vertical-align:top;border-left:1px solid rgb(189,189,189)">
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody>
<tr><td style="padding:0.01px">
<p style="margin:0.1px;line-height:19.2px;font-size:16px"><font style="color:rgb(100,100,100)" face="arial, sans-serif"><b>The Steps Foundation</b></font></p>
<p style="margin:0.1px;line-height:19.2px"><font face="arial, sans-serif"><i style="font-size:11px;text-align:center">Virtus, non Origo. \u2013 Character, not Origin.</i></font></p>
</td></tr>
<tr><td>
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tbody><tr><td nowrap style="padding-top:14px">
<p style="margin:1px;line-height:10.89px;font-size:11px;color:rgb(33,33,33)"><a href="mailto:events@thestepsfoundation.com" style="color:rgb(17,85,204)">events@thestepsfoundation.com</a></p>
</td></tr></tbody>
</table>
</td></tr>
</tbody></table>
</td>
</tr></tbody></table>
</td></tr></tbody></table>
</td></tr></tbody></table>
<p style="margin:0cm;font-size:9pt;color:red;font-family:arial,sans-serif;font-style:italic;margin-top:12px">
This message is intended only for the addressee and may contain information that is confidential or privileged. Unauthorised use is strictly prohibited and may be unlawful. If you are not the addressee, you should not read, copy, disclose or otherwise use this message, except for the purpose of delivery to the addressee. If you have received this in error, please delete it and advise The Steps Foundation.
</p>
`

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------
export type TemplateRow = {
  id: string
  name: string
  type: string
  subject: string
  body_html: string
  event_id: string | null
}

export type SendProgress = { sent: number; failed: number; total: number }

// ---------------------------------------------------------------------------
// EmailComposePanel — template strip + subject + body + save CTA + signature
// ---------------------------------------------------------------------------
export type EmailComposePanelProps = {
  // Template state
  templates: TemplateRow[]
  selectedTemplate: string
  templateDirty: boolean
  savingTemplate: boolean
  // Template handlers
  onApplyTemplate: (templateId: string) => void
  onEditTemplate: () => void               // opens the TemplateEditDialog (full edit)
  onRenameTemplate?: () => void            // optional quick-rename (if omitted, edit handles naming)
  onDeleteTemplate: () => void
  onSaveTemplateChanges: () => void
  onSaveAsNewTemplate: () => void
  onClearTemplate?: () => void  // optional — called when user picks the blank option in the dropdown
  // Template filter — invite modal scopes to current event; decision flow shows all
  templateFilter?: (t: TemplateRow) => boolean

  // Editor refs (owned by parent — let parent inject pills imperatively).
  // Typed as MutableRefObject to match `useRef<T | null>(null)` in both parents.
  subjectEditorRef: React.MutableRefObject<SingleLineMergeEditorHandle | null>
  bodyEditorRef: React.MutableRefObject<RichTextEmailEditorHandle | null>

  // Editor state
  emailSubject: string
  emailBody: string
  onSubjectChange: (value: string) => void
  onBodyChange: (html: string) => void
  onDirty: () => void  // called whenever an edit that would dirty the template occurs

  // Editor seeding — parents pass their own key strategy so re-seeding behaves
  // correctly (invite uses a counter, decision uses the selectedTemplate id).
  subjectEditorKey?: string | number
  bodyEditorKey?: string | number
  bodyInitialHtml: string  // what the body editor is seeded with on mount / re-key

  // Merge-tag palettes — parents supply the exact palettes since the two flows
  // have different dynamic tags (invite pulls tags from recipient applications).
  subjectMergeTags: MergeTag[]
  bodyMergeTags: MergeTag[]

  // Placeholders
  subjectPlaceholder?: string
  bodyPlaceholder?: string

  // Per-send attachments. Owned by the parent — when these are omitted the
  // editor hides the attach button (e.g. the template editor, where
  // attachments don't persist onto the template row).
  attachments?: EmailAttachmentInfo[]
  onAttach?: (att: EmailAttachmentInfo) => void
  onRemoveAttachment?: (url: string) => void
}

export function EmailComposePanel(props: EmailComposePanelProps) {
  const {
    templates, selectedTemplate, templateDirty, savingTemplate,
    onApplyTemplate, onEditTemplate, onRenameTemplate, onDeleteTemplate, onSaveTemplateChanges, onSaveAsNewTemplate, onClearTemplate,
    templateFilter,
    subjectEditorRef, bodyEditorRef,
    emailSubject, emailBody, onSubjectChange, onBodyChange, onDirty,
    subjectEditorKey, bodyEditorKey, bodyInitialHtml,
    subjectMergeTags, bodyMergeTags,
    subjectPlaceholder, bodyPlaceholder,
    attachments, onAttach, onRemoveAttachment,
  } = props

  const visibleTemplates = templateFilter ? templates.filter(templateFilter) : templates
  const currentName = templates.find(t => t.id === selectedTemplate)?.name

  return (
    <div className="space-y-4">
      {/* Template controls header strip */}
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-wide text-gray-400">Template</span>
          {selectedTemplate ? (
            <>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-[220px]" title={currentName}>
                {currentName ?? 'Untitled'}
              </span>
              <button
                type="button"
                onClick={onEditTemplate}
                disabled={savingTemplate}
                title="Edit template (name, subject, body)"
                className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-steps-blue-600 hover:bg-steps-blue-50 dark:hover:bg-steps-blue-900/20 disabled:opacity-40"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onDeleteTemplate}
                disabled={savingTemplate}
                title="Delete template"
                className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a2 2 0 012-2h2a2 2 0 012 2v3" />
                </svg>
              </button>
            </>
          ) : (
            <span className="text-sm text-gray-500 italic">No template &mdash; writing from scratch</span>
          )}
          <div className="flex-1" />
          <select
            value={selectedTemplate}
            onChange={e => {
              const id = e.target.value
              if (id === '__new__') { onSaveAsNewTemplate(); return }
              if (id) onApplyTemplate(id)
              else if (onClearTemplate) onClearTemplate()
            }}
            className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 max-w-[220px]"
          >
            <option value="">Change template…</option>
            {visibleTemplates.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.type}){!t.event_id ? ' — Global' : ''}
              </option>
            ))}
            <option value="__new__">+ Save current as new template…</option>
          </select>
        </div>
      </div>

      {/* Subject — pill-rendered single-line editor */}
      <div>
        <div className="flex items-center justify-between mb-1 gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Subject</label>
          <div className="flex flex-wrap gap-1 justify-end max-w-[65%]">
            <span className="text-[10px] text-gray-400 self-center mr-1">Insert:</span>
            {subjectMergeTags.map(({ tag, label }) => (
              <button
                key={tag}
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => {
                  subjectEditorRef.current?.insertMergeTag(tag, label)
                  onDirty()
                }}
                className="px-2 py-0.5 text-[11px] rounded-full border border-steps-blue-200 dark:border-steps-blue-800 bg-steps-blue-50 dark:bg-steps-blue-900/20 text-steps-blue-700 dark:text-steps-blue-300 hover:bg-steps-blue-100 dark:hover:bg-steps-blue-900/40 transition-colors"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <SingleLineMergeEditor
          key={subjectEditorKey != null ? `subj-${subjectEditorKey}` : undefined}
          ref={subjectEditorRef}
          value={emailSubject}
          onChange={v => { onSubjectChange(v); onDirty() }}
          placeholder={subjectPlaceholder ?? "e.g. You're Invited to {{event_name}}!"}
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Body</label>
          <span className="text-[10px] text-gray-400">Tags render as pills; replaced with real values on send.</span>
        </div>

        <MergeTagInsertBar
          tags={bodyMergeTags}
          onInsert={(tag, label) => {
            bodyEditorRef.current?.insertMergeTag(tag, label)
            onDirty()
          }}
        />

        <RichTextEmailEditor
          key={bodyEditorKey != null ? `body-${bodyEditorKey}` : undefined}
          ref={bodyEditorRef}
          initialHtml={bodyInitialHtml}
          onChange={html => { onBodyChange(html); onDirty() }}
          placeholder={bodyPlaceholder ?? `Hey {{first_name}},\n\nWe'd love for you to apply to {{event_name}}!\n\nApply here: {{apply_link}}\n\nBest wishes,\nThe Steps Foundation Team`}
          attachments={attachments}
          onAttach={onAttach}
          onRemoveAttachment={onRemoveAttachment}
        />

        {/* Save-back-to-template CTA */}
        {selectedTemplate && templateDirty && (
          <div className="mt-2 flex items-center justify-between rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2">
            <span className="text-xs text-amber-700 dark:text-amber-300">
              You&rsquo;ve edited this template. Save changes so future sends start from this version?
            </span>
            <button
              type="button"
              disabled={savingTemplate}
              onClick={onSaveTemplateChanges}
              className="text-xs font-medium px-3 py-1 rounded-md bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {savingTemplate ? 'Saving...' : 'Save to template'}
            </button>
          </div>
        )}

        {/* Signature preview */}
        <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3">
          <div className="text-[10px] text-gray-400 mb-1.5 uppercase tracking-wide">Email signature (auto-appended)</div>
          <div
            className="text-xs opacity-60 pointer-events-none"
            dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmailPreviewPanel — the from/to/subject/body preview card
// ---------------------------------------------------------------------------
export type EmailPreviewPanelProps = {
  recipientName: string        // "First Last"
  recipientEmail: string | null
  filledSubject: string        // subject with merge tags already replaced
  filledBodyHtml: string       // body HTML with merge tags already replaced (signature handled inside)
  appendSignature?: boolean    // default true — append EMAIL_SIGNATURE_HTML to the body
  footerBanner?: ReactNode     // amber callout below the preview (recipient count, status-change note, etc.)
}

// ---------------------------------------------------------------------------
// EmailBodyFrame — renders the composed body inside a sandboxed iframe so the
// preview is CSS-isolated from the app. The app's Tailwind Preflight resets
// list styling (<ul>/<li> render with no bullets or indent), which made
// malformed list markup look clean in the old in-div preview while Gmail
// rendered real bullets (including empty <li> ones). A bare iframe with
// default user-agent styles matches what mail clients actually show, so the
// admin sees the true formatting before sending.
//
// sandbox="allow-same-origin" (no allow-scripts) keeps scripts in the body
// from executing while still letting us read scrollHeight to auto-size.
// ---------------------------------------------------------------------------
function EmailBodyFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [height, setHeight] = useState(360)
  const srcDoc =
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;padding:0;background:#fff;color:#222;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;' +
    '-webkit-text-size-adjust:100%}body{padding:2px 2px 8px}' +
    'img{max-width:100%}</style></head><body>' + html + '</body></html>'
  const measure = () => {
    const doc = ref.current?.contentDocument
    if (!doc) return
    const h = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0)
    if (h > 0) setHeight(h + 4)
  }
  return (
    <iframe
      ref={ref}
      title="Email body preview"
      srcDoc={srcDoc}
      sandbox="allow-same-origin"
      onLoad={() => { measure(); setTimeout(measure, 200) }}
      className="w-full border-0 bg-white rounded-sm"
      style={{ height }}
    />
  )
}

export function EmailPreviewPanel(props: EmailPreviewPanelProps) {
  const { recipientName, recipientEmail, filledSubject, filledBodyHtml, appendSignature = true, footerBanner } = props
  const body = appendSignature ? filledBodyHtml + EMAIL_SIGNATURE_HTML : filledBodyHtml
  const wrappedBody = wrapHtmlForEmail(body)
  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600 dark:text-gray-300">
        Preview with first recipient: <strong>{recipientName}</strong>
      </div>
      <div className="rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">From: Events - The Steps Foundation &lt;events@thestepsfoundation.com&gt;</div>
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">To: {recipientEmail ?? '—'}</div>
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3 pb-3 border-b border-gray-200 dark:border-gray-700">
          {filledSubject}
        </div>
        <EmailBodyFrame html={wrappedBody} />
      </div>
      {footerBanner}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmailSendingPanel — spinner + progress + optional abort button
// ---------------------------------------------------------------------------
export type EmailSendingPanelProps = {
  progress: SendProgress
  aborted?: boolean
  onAbort?: () => void          // if provided, renders the Stop sending button while not aborted
}

export function EmailSendingPanel(props: EmailSendingPanelProps) {
  const { progress, aborted = false, onAbort } = props
  const pct = progress.total > 0 ? ((progress.sent + progress.failed) / progress.total) * 100 : 0
  return (
    <div className="text-center py-10">
      <div className="text-4xl mb-3">&#9993;</div>
      <div className="text-sm text-gray-600 dark:text-gray-300">
        {aborted ? 'Stopping after in-flight send…' : `Sending ${progress.sent + progress.failed} / ${progress.total}…`}
      </div>
      <div className="w-48 mx-auto mt-3 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
        <div className="h-full rounded-full bg-steps-blue-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {onAbort && !aborted && (
        <button
          onClick={onAbort}
          className="mt-4 px-3 py-1.5 text-xs rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          title="Halt the batch after the in-flight send finishes. Sent emails can't be recalled."
        >
          Stop sending
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EmailDonePanel — tick/warn + sent/failed counts + optional extra slot
// ---------------------------------------------------------------------------
export type EmailDonePanelProps = {
  progress: SendProgress
  aborted?: boolean
  extra?: ReactNode            // flow-specific line (e.g. "Statuses updated to X")
  footerNote?: string          // defaults to "Sent from events@thestepsfoundation.com"
}

export function EmailDonePanel(props: EmailDonePanelProps) {
  const { progress, aborted = false, extra, footerNote = 'Sent from events@thestepsfoundation.com' } = props
  const skipped = progress.total - progress.sent - progress.failed
  return (
    <div className="text-center py-10">
      <div className="text-4xl mb-3">{aborted ? '⚠️' : '✓'}</div>
      <div className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-1">
        {aborted ? 'Send stopped' : 'Emails sent!'}
      </div>
      <div className="text-sm text-gray-500">
        {progress.sent} sent{progress.failed > 0 ? `, ${progress.failed} failed` : ''}
        {aborted && skipped > 0 ? `, ${skipped} skipped` : ''}
      </div>
      {extra}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
        {footerNote}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TemplateEditDialog — full in-place template editor shown above the compose
// modal. Lets users edit name, type, subject (with pills) and body (rich
// editor with formatting, hyperlinks, pills) then save back to the DB.
//
// This replaces the rename-only affordance that was previously wired to the
// pencil icon in the compose header strip.
// ---------------------------------------------------------------------------
export type TemplateDraft = {
  name: string
  type: string
  subject: string
  body_html: string
}

export type TemplateEditDialogProps = {
  initial: TemplateRow
  saving: boolean
  error?: string | null
  onSave: (draft: TemplateDraft) => void | Promise<void>
  onCancel: () => void
  // Allow parents to constrain which types are available; defaults cover the
  // current set used across the compose flows.
  templateTypes?: { code: string; label: string }[]
  // Merge-tag palette — defaults to DEFAULT_MERGE_TAGS so every tag the system
  // supports is insertable.
  mergeTags?: MergeTag[]
}

const DEFAULT_TEMPLATE_TYPES: { code: string; label: string }[] = [
  { code: 'acceptance', label: 'Acceptance' },
  { code: 'rejection', label: 'Rejection' },
  { code: 'waitlist', label: 'Waitlist' },
  { code: 'invite', label: 'Invite' },
  { code: 'test_invite', label: 'Test invite' },
  { code: 'reminder', label: 'Reminder' },
  { code: 'follow_up', label: 'Follow-up' },
  { code: 'custom', label: 'Custom' },
]

export function TemplateEditDialog(props: TemplateEditDialogProps) {
  const { initial, saving, error, onSave, onCancel } = props
  const templateTypes = props.templateTypes ?? DEFAULT_TEMPLATE_TYPES
  const mergeTags = props.mergeTags ?? DEFAULT_MERGE_TAGS

  const [name, setName] = useState(initial.name)
  const [type, setType] = useState(initial.type)
  const [subject, setSubject] = useState(initial.subject)
  const [bodyHtml, setBodyHtml] = useState(initial.body_html)

  const subjectRef = useRef<SingleLineMergeEditorHandle | null>(null)
  const bodyRef = useRef<RichTextEmailEditorHandle | null>(null)

  // Re-seed editors if the caller swaps the template under us.
  useEffect(() => {
    setName(initial.name)
    setType(initial.type)
    setSubject(initial.subject)
    setBodyHtml(initial.body_html)
  }, [initial.id])

  const canSave = !!name.trim() && !!subject.trim() && !!bodyHtml.trim() && !saving

  return (
    // Stop clicks from bubbling to any parent backdrop (e.g. the invite
    // modal wraps a click-to-close div around our render tree). Without this,
    // a click on the subject/body/name editor fires onClose on the parent
    // modal and unmounts everything back to the event edit page.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit template</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Updating this template will change what future sends start from.</p>
          </div>
          {!saving && (
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" aria-label="Close">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Starting Point Acceptance"
                className="w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Type</label>
              <select
                value={type}
                onChange={e => setType(e.target.value)}
                className="w-full px-2 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm"
              >
                {templateTypes.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Subject line</label>
            <MergeTagInsertBar
              tags={mergeTags}
              onInsert={(tag, label) => subjectRef.current?.insertMergeTag(tag, label)}
            />
            <SingleLineMergeEditor
              key={`tpl-subj-${initial.id}`}
              ref={subjectRef}
              value={subject}
              onChange={setSubject}
              placeholder="e.g. Your application to {{event_name}} has been accepted!"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Body</label>
              <span className="text-[10px] text-gray-400">Merge tags render as pills; they&rsquo;re replaced with real values on send.</span>
            </div>
            <MergeTagInsertBar
              tags={mergeTags}
              onInsert={(tag, label) => bodyRef.current?.insertMergeTag(tag, label)}
            />
            <RichTextEmailEditor
              key={`tpl-body-${initial.id}`}
              ref={bodyRef}
              initialHtml={bodyHtml}
              onChange={setBodyHtml}
              placeholder={'Hi {{first_name}},\n\n...\n\nVirtus non origo,\nThe Steps Foundation Team'}
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ name: name.trim(), type, subject, body_html: bodyHtml })}
            disabled={!canSave}
            className="px-4 py-1.5 text-sm rounded-md bg-steps-blue-600 text-white hover:bg-steps-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  )
}
