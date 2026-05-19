'use client'

// ---------------------------------------------------------------------------
// Shared rich-text editor for email templates and email compose flows.
//
// - Renders merge tags like {{first_name}} as blue pill "chips" while editing,
//   then serialises them back to {{tag}} tokens on change so the persisted
//   body / sent email stays a plain {{tag}}-style template.
// - Provides a formatting toolbar (bold/italic/underline/strike, text colour,
//   highlight, lists, link, image, clear).
// - Supports file attachments (images + PDFs) via the existing `event-banners`
//   Supabase storage bucket. Attachments are NOT inserted inline; the editor
//   uploads the file and fires `onAttach` so the parent compose panel can
//   track them in per-send state and include them in the MIME envelope.
//
// Used from:
//   - src/app/students/events/[id]/page.tsx (Accept/Waitlist/Reject notify flow)
//   - src/app/students/emails/templates/page.tsx (template editor)
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

// ---------------------------------------------------------------------------
// Merge-tag palette — the canonical list of template variables available
// across every email flow. Kept in one place so both the templates page and
// the notify-compose flow insert identical chips.
// ---------------------------------------------------------------------------

export const MERGE_TAG_LABELS: Record<string, string> = {
  first_name: 'First Name',
  last_name: 'Last Name',
  full_name: 'Full Name',
  email: 'Email',
  event_name: 'Event Name',
  event_date: 'Event Date',
  event_time: 'Event Time',
  event_location: 'Location',
  event_format: 'Format',
  event_capacity: 'Capacity',
  event_dress_code: 'Dress Code',
  dress_code: 'Dress Code',
  open_to: 'Open To',
  application_deadline: 'Application Deadline',
  apply_link: 'Apply Link',
  rsvp_link: 'RSVP Link',
  portal_link: 'Portal Link',
  last_attended_event: 'Last Event',
  withdraw_link: 'Withdraw link',
  event_optout_link: 'Opt-out link (this event only)',
}

/**
 * Admin-set label overrides for chip rendering. Set by the page-level
 * component (events composer / InviteStudentsModal) when it reads settings.
 * tokensToChips reads this in preference to MERGE_TAG_LABELS so that admin
 * relabels on Settings → Merge tag formats are reflected on every chip
 * (picker AND inserted AND round-tripped through chipsToTokens / tokens
 * ToChips).
 *
 * Module-level mutable state is acceptable here because the page sets this
 * before the editor renders; the alternative would be threading the map
 * through every chip-touching API (insertMergeTag, tokensToChips, the
 * editor's seed effect), which is far noisier.
 */
let MERGE_TAG_LABEL_OVERRIDES: Record<string, string> = {}
export function setMergeTagLabelOverrides(overrides: Record<string, string>): void {
  MERGE_TAG_LABEL_OVERRIDES = overrides ?? {}
}

export type MergeTag = { tag: string; label: string }

// Shape of an email attachment chip — a reference to a file already
// uploaded to Supabase storage. The editor doesn't own this state; the
// parent compose panel does, and passes the list in via `attachments`
// plus a `onAttach` / `onRemoveAttachment` pair for mutation.
export type EmailAttachmentInfo = {
  url: string
  filename: string
  mime_type: string
  size_bytes: number
}

export const DEFAULT_MERGE_TAGS: MergeTag[] = [
  { tag: 'first_name', label: 'First Name' },
  { tag: 'last_name', label: 'Last Name' },
  { tag: 'full_name', label: 'Full Name' },
  { tag: 'email', label: 'Email' },
  { tag: 'event_name', label: 'Event Name' },
  { tag: 'event_date', label: 'Event Date' },
  { tag: 'event_time', label: 'Event Time' },
  { tag: 'event_location', label: 'Location' },
  { tag: 'dress_code', label: 'Dress Code' },
  { tag: 'open_to', label: 'Open To' },
  { tag: 'application_deadline', label: 'Application Deadline' },
  { tag: 'last_attended_event', label: 'Last Event' },
  { tag: 'apply_link', label: 'Apply Link' },
  { tag: 'rsvp_link', label: 'RSVP Link' },
  { tag: 'portal_link', label: 'Portal Link' },
]

// ---------------------------------------------------------------------------
// Chip serialisation helpers
// ---------------------------------------------------------------------------

export function makeChipHtml(tag: string, label?: string, bold?: boolean): string {
  const safeTag = tag.replace(/[^a-zA-Z0-9_]/g, '')
  const text = (label ?? MERGE_TAG_LABEL_OVERRIDES[safeTag] ?? MERGE_TAG_LABELS[safeTag] ?? safeTag)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const weight = bold ? 700 : 500
  const boldAttr = bold ? ' data-bold="true"' : ''
  return `<span class="merge-tag-chip" contenteditable="false" data-tag="${safeTag}"${boldAttr} style="display:inline-block;padding:1px 8px;margin:0 2px;border-radius:9999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;font-size:11px;font-weight:${weight};line-height:18px;vertical-align:baseline;user-select:all;white-space:nowrap;">${text}</span>`
}

export function tokensToChips(html: string): string {
  // Bold-wrapped tokens come first so the surrounding <strong>/<b> gets
  // consumed and we emit a chip with data-bold='true' (which survives
  // chipsToTokens on the next round-trip).
  return html
    .replace(/<(strong|b)\b[^>]*>\s*\{\{(\w+)\}\}\s*<\/\1>/g, (_m, _tag, tag) => makeChipHtml(tag, undefined, true))
    .replace(/\{\{(\w+)\}\}/g, (_m, tag) => makeChipHtml(tag))
}

export function chipsToTokens(html: string): string {
  if (typeof document === 'undefined') return html
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  tpl.content.querySelectorAll('span.merge-tag-chip').forEach(span => {
    const tag = span.getAttribute('data-tag') || ''
    const bold = span.getAttribute('data-bold') === 'true'
    if (bold) {
      const strong = document.createElement('strong')
      strong.appendChild(document.createTextNode(`{{${tag}}}`))
      span.replaceWith(strong)
    } else {
      span.replaceWith(document.createTextNode(`{{${tag}}}`))
    }
  })
  return tpl.innerHTML
}

// Convert plain-text email body into Gmail-friendly HTML.
export function plainTextToHtml(text: string): string {
  if (!text) return ''
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return text
    .split(/\n{2,}/)
    .map(block =>
      `<p style="margin:0 0 12px;font-family:arial,sans-serif;font-size:14px;line-height:1.5;color:#222">` +
      escape(block).replace(/\n/g, '<br>') +
      `</p>`
    )
    .join('')
}

export function looksLikeHtml(s: string): boolean {
  return /<[a-z!\/]/i.test(s)
}

// ---------------------------------------------------------------------------
// Imperative handle — parent components inject merge-tag chips at caret via
// this ref.
// ---------------------------------------------------------------------------

export type RichTextEmailEditorHandle = {
  insertText: (text: string) => void
  insertMergeTag: (tag: string, label?: string) => void
  focus: () => void
}

export type RichTextEmailEditorProps = {
  /** HTML to seed the editor with. Re-keyed when the surrounding template
   *  changes so the contenteditable isn't overwritten on every keystroke. */
  initialHtml: string
  /** Called whenever the user edits — receives current innerHTML with
   *  chip <span>s converted back to {{tag}} tokens. */
  onChange: (html: string) => void
  /** Placeholder shown when the editor is empty. */
  placeholder?: string
  /** Optional: disable file upload entirely (e.g. template editor, where
   *  attachments don't persist onto templates). */
  disableImages?: boolean
  /** Current attachment list rendered as chips above the editor. If omitted
   *  AND onAttach is omitted, the attach button is hidden entirely. */
  attachments?: EmailAttachmentInfo[]
  /** Called after a successful upload — parent should push onto its
   *  per-send attachment state. If omitted the attach button is hidden. */
  onAttach?: (att: EmailAttachmentInfo) => void
  /** Called when the user clicks the × on an attachment chip. */
  onRemoveAttachment?: (url: string) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const RichTextEmailEditor = React.forwardRef<RichTextEmailEditorHandle, RichTextEmailEditorProps>(function RichTextEmailEditor(
  { initialHtml, onChange, placeholder, disableImages, attachments, onAttach, onRemoveAttachment },
  forwardedRef,
) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const savedRange = useRef<Range | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isEmpty, setIsEmpty] = useState(!initialHtml || initialHtml === '<br>' || initialHtml === '<p><br></p>')
  const [uploading, setUploading] = useState(false)
  // Link-prompt state — mirrors LinkableInput's Ctrl+K dialog so the email
  // editor gets the same "select text → Ctrl+K → Text/URL fields → Add" flow
  // as the application form editor.
  const [linkPromptOpen, setLinkPromptOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [linkIsEditingExisting, setLinkIsEditingExisting] = useState(false)

  // Seed the div on mount / when initialHtml identity changes (new template).
  useEffect(() => {
    if (!divRef.current) return
    const seeded = tokensToChips(initialHtml || '')
    if (divRef.current.innerHTML !== seeded) {
      divRef.current.innerHTML = seeded
      setIsEmpty(!divRef.current.textContent)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialHtml])

  const saveSelection = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.rangeCount > 0 && divRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    if (!savedRange.current || !divRef.current) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }

  // Walk up from a node to find an ancestor <a> inside the editor surface.
  const findAncestorAnchor = (node: Node | null): HTMLAnchorElement | null => {
    let cur: Node | null = node
    while (cur && cur !== divRef.current) {
      if ((cur as HTMLElement).tagName === 'A') return cur as HTMLAnchorElement
      cur = cur.parentNode
    }
    return null
  }

  // Normalise a user-typed URL — prepend https:// when they leave off the scheme.
  const normaliseUrl = (raw: string): string => {
    const url = raw.trim()
    if (!url) return ''
    if (/^(https?:|mailto:)/i.test(url)) return url
    if (/^www\./i.test(url)) return 'https://' + url
    // Bare domain heuristic: contains a dot, no whitespace, no @ before the first slash.
    if (/^[^\s@]+\.[^\s]+$/i.test(url)) return 'https://' + url
    return url
  }

  // Detect whether a pasted string is a lone URL that we should auto-hyperlink.
  const looksLikeBareUrl = (s: string): boolean => {
    const t = s.trim()
    if (!t || /\s/.test(t)) return false
    return /^(https?:\/\/|mailto:)[^\s]+$/i.test(t) || /^www\.[^\s]+\.[^\s]+$/i.test(t)
  }

  const openLinkPrompt = () => {
    saveSelection()
    const range = savedRange.current
    const selectedText = range ? range.toString() : ''
    const anchor = range ? findAncestorAnchor(range.startContainer) : null
    if (anchor) {
      setLinkIsEditingExisting(true)
      setLinkUrl(anchor.getAttribute('href') ?? '')
      setLinkText(anchor.textContent ?? '')
    } else {
      setLinkIsEditingExisting(false)
      setLinkUrl('')
      setLinkText(selectedText)
    }
    setLinkPromptOpen(true)
    // Focus the URL input after it mounts.
    setTimeout(() => {
      const el = document.getElementById('rte-link-url') as HTMLInputElement | null
      el?.focus()
      el?.select()
    }, 10)
  }

  const confirmLinkPrompt = () => {
    const url = normaliseUrl(linkUrl)
    if (!url) { setLinkPromptOpen(false); return }
    const text = linkText.trim() || url

    divRef.current?.focus()
    restoreSelection()

    if (linkIsEditingExisting && savedRange.current) {
      const anchor = findAncestorAnchor(savedRange.current.startContainer)
      if (anchor) {
        anchor.setAttribute('href', url)
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
        anchor.textContent = text
      }
    } else {
      const range = savedRange.current
      if (range) {
        range.deleteContents()
        const a = document.createElement('a')
        a.setAttribute('href', url)
        a.setAttribute('target', '_blank')
        a.setAttribute('rel', 'noopener noreferrer')
        a.textContent = text
        range.insertNode(a)
        // Place caret after the new anchor.
        const after = document.createRange()
        after.setStartAfter(a)
        after.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(after)
      }
    }

    setLinkPromptOpen(false)
    emitChange()
  }

  const removeLinkAtSelection = () => {
    const range = savedRange.current
    const anchor = range ? findAncestorAnchor(range.startContainer) : null
    if (anchor) {
      const text = document.createTextNode(anchor.textContent ?? '')
      anchor.replaceWith(text)
      emitChange()
    }
    setLinkPromptOpen(false)
  }

  const cancelLinkPrompt = () => {
    setLinkPromptOpen(false)
    divRef.current?.focus()
    restoreSelection()
  }

  // Keydown — open link prompt on Ctrl+K / Cmd+K.
  const onEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault()
      openLinkPrompt()
    }
  }

  // Style properties we keep when sanitising pasted HTML. Everything else
  // (font-family, font-size, margin, line-height, color, background-color, …)
  // is stripped so pasted text inherits the editor's own styling.
  const PASTE_KEEP_STYLE_PROPS = new Set([
    'font-weight',
    'font-style',
    'text-decoration',
    'text-align',
  ])

  // Normalise a pasted HTML fragment: drop Gmail/Docs/Word wrapper classes and
  // inline font/size/margin styles, but preserve bold/italic/underline, links,
  // and lists. Merge-tag chips are not a concern here (pasted content comes
  // from outside the editor).
  const sanitisePastedHtml = (html: string): string => {
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    // Strip everything that isn't content.
    tpl.content
      .querySelectorAll('meta, style, link, script, title, head, base')
      .forEach(n => n.remove())
    // Remove HTML comments (handles Word's MSO conditional comments too).
    const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_COMMENT)
    const comments: Node[] = []
    let c: Node | null
    while ((c = walker.nextNode())) comments.push(c)
    comments.forEach(n => n.parentNode?.removeChild(n))
    // Unwrap <font> tags — move children up in place.
    Array.from(tpl.content.querySelectorAll('font')).forEach(fontEl => {
      const parent = fontEl.parentNode
      if (!parent) return
      while (fontEl.firstChild) parent.insertBefore(fontEl.firstChild, fontEl)
      parent.removeChild(fontEl)
    })
    // Clean attributes on every surviving element.
    tpl.content.querySelectorAll('*').forEach(el => {
      el.removeAttribute('class')
      el.removeAttribute('id')
      el.removeAttribute('bgcolor')
      el.removeAttribute('color')
      el.removeAttribute('face')
      el.removeAttribute('size')
      const style = el.getAttribute('style')
      if (!style) return
      const kept: string[] = []
      for (const decl of style.split(';')) {
        const colonIdx = decl.indexOf(':')
        if (colonIdx < 0) continue
        const prop = decl.slice(0, colonIdx).trim().toLowerCase()
        const val = decl.slice(colonIdx + 1).trim()
        if (!prop || !val) continue
        if (PASTE_KEEP_STYLE_PROPS.has(prop)) kept.push(`${prop}: ${val}`)
      }
      if (kept.length > 0) el.setAttribute('style', kept.join('; '))
      else el.removeAttribute('style')
    })
    return tpl.innerHTML
  }

  // Paste handler. Priority:
  //   1. If clipboard has HTML (Gmail, Docs, Word, any web page), sanitise and
  //      insert — this strips wrapper font-family/size so pasted text matches
  //      the editor's styling. Bold/italic/underline/links/lists survive.
  //   2. Otherwise, if plain text looks like a bare URL, auto-hyperlink it.
  //   3. Otherwise, fall through to the browser's default plain-text paste.
  const onEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')
    if (html) {
      e.preventDefault()
      insertHtmlAtCaret(sanitisePastedHtml(html))
      return
    }
    if (!looksLikeBareUrl(plain)) return
    e.preventDefault()
    const sel = window.getSelection()
    const hasSelection = !!(sel && sel.rangeCount > 0 && !sel.isCollapsed && divRef.current?.contains(sel.anchorNode))
    const url = normaliseUrl(plain)
    const text = hasSelection ? (sel?.toString() ?? plain) : plain
    const safeText = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const urlHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer">${safeText}</a>&nbsp;`
    insertHtmlAtCaret(urlHtml)
  }

  const emitChange = () => {
    if (!divRef.current) return
    onChange(chipsToTokens(divRef.current.innerHTML))
    setIsEmpty(!divRef.current.textContent)
  }

  const exec = (cmd: string, value?: string) => {
    restoreSelection()
    divRef.current?.focus()
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand(cmd, false, value)
    } catch {
      // Old browsers / disabled execCommand — silently no-op.
    }
    saveSelection()
    emitChange()
  }

  // Toggle bold on chips inside the current selection BEFORE falling
  // through to execCommand('bold') for surrounding text. execCommand
  // can't wrap contenteditable=false elements (the chips), so the CSS
  // approach alone never worked — this is the workaround that does.
  const handleBold = () => {
    saveSelection()
    const sel = window.getSelection()
    const chips: HTMLElement[] = []
    if (sel && sel.rangeCount > 0 && divRef.current) {
      const range = sel.getRangeAt(0)
      const allChips = Array.from(divRef.current.querySelectorAll<HTMLElement>('span.merge-tag-chip'))
      for (const chip of allChips) {
        // intersectsNode is widely supported; fall back to a bounding-rect
        // check if not available.
        const intersects = typeof range.intersectsNode === 'function'
          ? range.intersectsNode(chip)
          : range.comparePoint(chip, 0) === 0
        if (intersects) chips.push(chip)
      }
    }
    if (chips.length > 0) {
      const allBold = chips.every(c => c.getAttribute('data-bold') === 'true')
      for (const chip of chips) {
        if (allBold) {
          chip.removeAttribute('data-bold')
          chip.style.fontWeight = '500'
        } else {
          chip.setAttribute('data-bold', 'true')
          chip.style.fontWeight = '700'
        }
      }
      emitChange()
    }
    // Still call execCommand so non-chip selected text bolds too.
    exec('bold')
  }

  // Insert arbitrary HTML at the caret — used for chips and inline images.
  const insertHtmlAtCaret = (html: string) => {
    restoreSelection()
    divRef.current?.focus()
    try {
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      document.execCommand('insertHTML', false, html)
    } catch {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && divRef.current) {
        const range = sel.getRangeAt(0)
        const tplEl = document.createElement('template')
        tplEl.innerHTML = html
        range.deleteContents()
        range.insertNode(tplEl.content)
      }
    }
    saveSelection()
    emitChange()
  }

  const insertChipAtCaret = (tag: string, label?: string) => {
    if (!divRef.current) return
    // Make sure the editor is focused so getSelection() refers to it.
    divRef.current.focus()
    restoreSelection()

    const sel = window.getSelection()
    let range: Range
    if (sel && sel.rangeCount > 0 && divRef.current.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0)
    } else {
      // No saved selection inside the editor — drop the chip at the end of
      // the current content. Better than nothing if the picker was clicked
      // before the user ever placed their caret.
      range = document.createRange()
      range.selectNodeContents(divRef.current)
      range.collapse(false)
    }

    // Build the chip + trailing non-breaking space as detached DOM nodes so
    // we can place the caret AFTER them deterministically (without relying on
    // execCommand's positioning behaviour).
    const chipWrapper = document.createElement('span')
    chipWrapper.innerHTML = makeChipHtml(tag, label)
    const chipEl = chipWrapper.firstElementChild as HTMLElement | null
    if (!chipEl) return
    const trailingSpace = document.createTextNode('\u00a0') // &nbsp;

    range.deleteContents()
    range.insertNode(trailingSpace)
    range.insertNode(chipEl)

    // Collapse selection to AFTER the trailing space so the user types
    // inline immediately after the chip.
    const after = document.createRange()
    after.setStartAfter(trailingSpace)
    after.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(after)

    saveSelection()
    emitChange()
  }

  React.useImperativeHandle(forwardedRef, () => ({
    insertText: (text: string) => exec('insertText', text),
    insertMergeTag: (tag: string, label?: string) => insertChipAtCaret(tag, label),
    focus: () => divRef.current?.focus(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onChange])

  // Upload a selected file (image or PDF) to Supabase storage and hand the
  // public URL off to the parent via onAttach. We do NOT insert anything into
  // the body — attachments travel in the MIME envelope instead of inline.
  const handleImageFile = async (file: File) => {
    const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type)
    const isPdf = file.type === 'application/pdf'
    if (!isImage && !isPdf) {
      alert('Attach a JPG, PNG, WebP, GIF or PDF.')
      return
    }
    // Keep client cap below the server cap in email-mime.ts (20MB) so size
    // failures surface before the upload round trip.
    if (file.size > 20 * 1024 * 1024) {
      alert('Max attachment size is 20 MB.')
      return
    }
    if (!onAttach) return  // shouldn't be reachable — button is hidden
    setUploading(true)
    try {
      const extFromName = file.name.split('.').pop()?.toLowerCase()
      const ext = extFromName || (isPdf ? 'pdf' : 'bin')
      const objectKey = `email-attachments/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase
        .storage
        .from('event-banners')
        .upload(objectKey, file, { cacheControl: '3600', upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('event-banners').getPublicUrl(objectKey)
      if (!pub?.publicUrl) throw new Error('Could not resolve public URL')
      onAttach({
        url: pub.publicUrl,
        filename: file.name,
        mime_type: file.type,
        size_bytes: file.size,
      })
    } catch (err: any) {
      console.error('attachment upload failed', err)
      alert(err?.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 flex-wrap">
        <ToolbarBtn title="Bold (Ctrl+B)" onClick={() => handleBold()}>
          <span className="font-bold">B</span>
        </ToolbarBtn>
        <ToolbarBtn title="Italic (Ctrl+I)" onClick={() => exec('italic')}>
          <span className="italic">I</span>
        </ToolbarBtn>
        <ToolbarBtn title="Underline (Ctrl+U)" onClick={() => exec('underline')}>
          <span className="underline">U</span>
        </ToolbarBtn>
        <ToolbarBtn title="Strikethrough" onClick={() => exec('strikeThrough')}>
          <span className="line-through">S</span>
        </ToolbarBtn>
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        {/* Text colour */}
        <label
          className="relative inline-flex items-center justify-center w-7 h-7 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
          title="Text colour"
        >
          <span className="text-xs font-bold">A</span>
          <span className="absolute bottom-0.5 left-1 right-1 h-0.5 bg-gradient-to-r from-red-500 via-amber-500 to-steps-blue-500 rounded" />
          <input
            type="color"
            onMouseDown={saveSelection}
            onChange={e => exec('foreColor', e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        {/* Highlight / background colour */}
        <label
          className="relative inline-flex items-center justify-center w-7 h-7 rounded hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer"
          title="Highlight colour"
        >
          <span className="text-xs font-bold" style={{ backgroundColor: '#fef08a', padding: '0 3px', borderRadius: 2 }}>A</span>
          <input
            type="color"
            onMouseDown={saveSelection}
            onChange={e => {
              // Some browsers call this `hiliteColor`, others `backColor`.
              // Try hiliteColor first (standards-compliant), fall back to backColor.
              restoreSelection()
              divRef.current?.focus()
              try {
                // eslint-disable-next-line @typescript-eslint/no-deprecated
                const ok = document.execCommand('hiliteColor', false, e.target.value)
                if (!ok) {
                  // eslint-disable-next-line @typescript-eslint/no-deprecated
                  document.execCommand('backColor', false, e.target.value)
                }
              } catch {
                // ignore
              }
              saveSelection()
              emitChange()
            }}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn title="Numbered list" onClick={() => exec('insertOrderedList')}>
          <span className="text-xs">1.</span>
        </ToolbarBtn>
        <ToolbarBtn title="Bulleted list" onClick={() => exec('insertUnorderedList')}>
          <span className="text-xs">•</span>
        </ToolbarBtn>
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn
          title="Insert link (Ctrl+K)"
          onClick={openLinkPrompt}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
        </ToolbarBtn>
        <ToolbarBtn title="Remove link" onClick={() => exec('unlink')}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656m-1.002-6.997a4 4 0 015.656 0l4 4a4 4 0 01-5.656 5.656M3 3l18 18" /></svg>
        </ToolbarBtn>
        {!disableImages && onAttach && (
          <>
            <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
            <ToolbarBtn
              title={uploading ? 'Uploading…' : 'Attach file (image or PDF)'}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16" /></svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.415a4 4 0 10-5.656-5.656L5.172 11.343a6 6 0 008.486 8.486L18 15.485" /></svg>
              )}
            </ToolbarBtn>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void handleImageFile(f)
                e.target.value = ''
              }}
            />
          </>
        )}
        <div className="w-px h-4 mx-1 bg-gray-300 dark:bg-gray-600" />
        <ToolbarBtn title="Clear formatting" onClick={() => exec('removeFormat')}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </ToolbarBtn>
      </div>

      {/* Attachment chips — rendered between toolbar and editor surface so
          users see what's about to travel with the email. Gated on the list
          being non-empty so the strip only appears when there's something
          to show. */}
      {attachments && attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
          {attachments.map(att => (
            <span
              key={att.url}
              className="inline-flex items-center gap-1.5 max-w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-gray-700 dark:text-gray-200"
              title={`${att.filename} — ${formatBytes(att.size_bytes)}`}
            >
              <svg className="w-3 h-3 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.415a4 4 0 10-5.656-5.656L5.172 11.343a6 6 0 008.486 8.486L18 15.485" />
              </svg>
              <span className="truncate max-w-[180px]">{att.filename}</span>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{formatBytes(att.size_bytes)}</span>
              {onRemoveAttachment && (
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(att.url)}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  aria-label={`Remove ${att.filename}`}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Editor surface */}
      <div className="relative">
        {isEmpty && placeholder && (
          <div className="absolute top-2.5 left-3 text-sm text-gray-400 pointer-events-none whitespace-pre-line">
            {placeholder}
          </div>
        )}
        <div
          ref={divRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emitChange}
          onBlur={saveSelection}
          onKeyDown={onEditorKeyDown}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={onEditorPaste}
          className="min-h-[180px] max-h-[420px] overflow-y-auto px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none"
          style={{ lineHeight: 1.5 }}
        />

        {/* Inline link prompt — Ctrl+K or toolbar link button */}
        {linkPromptOpen && (
          <div
            className="absolute z-20 left-2 right-2 bottom-2 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg space-y-1"
            onMouseDown={e => e.preventDefault()}
          >
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500 w-12">Text</label>
              <input
                value={linkText}
                onChange={e => setLinkText(e.target.value)}
                placeholder="Link text"
                className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-gray-500 w-12">URL</label>
              <input
                id="rte-link-url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder="https://..."
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmLinkPrompt() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelLinkPrompt() }
                }}
                className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-900"
              />
            </div>
            <div className="flex items-center gap-1 justify-end pt-1">
              {linkIsEditingExisting && (
                <button type="button" onClick={removeLinkAtSelection} className="px-2 py-0.5 text-[11px] text-red-600 hover:underline">Remove link</button>
              )}
              <button type="button" onClick={cancelLinkPrompt} className="px-2 py-0.5 text-[11px] text-gray-500 hover:underline">Cancel</button>
              <button type="button" onClick={confirmLinkPrompt} className="px-2 py-0.5 text-[11px] bg-steps-blue-600 text-white rounded hover:bg-steps-blue-700">
                {linkIsEditingExisting ? 'Update' : 'Add link'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

// Human-readable byte size for attachment chip labels.
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ToolbarBtn(
  { title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }
) {
  return (
    <button
      type="button"
      title={title}
      // preventDefault on mousedown stops the contenteditable from losing focus
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Merge-tag insert chip bar — renders a row of buttons that insert merge-tag
// pills at the caret. Shared between the templates page and the notify-
// compose flow so the available variables stay in sync.
// ---------------------------------------------------------------------------

export function MergeTagInsertBar({
  tags,
  onInsert,
  label = 'Insert:',
}: {
  tags: MergeTag[]
  onInsert: (tag: string, label?: string) => void
  label?: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      <span className="text-[10px] text-gray-400 self-center mr-1">{label}</span>
      {tags.map(({ tag, label: l }) => (
        <button
          key={tag}
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={() => onInsert(tag, l)}
          className="px-2 py-0.5 text-[11px] rounded-full border border-steps-blue-200 dark:border-steps-blue-800 bg-steps-blue-50 dark:bg-steps-blue-900/20 text-steps-blue-700 dark:text-steps-blue-300 hover:bg-steps-blue-100 dark:hover:bg-steps-blue-900/40 transition-colors"
        >
          {l}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single-line merge-tag editor — used for subject lines. Renders the same
// blue-pill chips for {{tag}} tokens but is contenteditable in a single
// row: Enter/Shift+Enter are swallowed, newlines pasted in as spaces, no
// formatting toolbar.
// ---------------------------------------------------------------------------

export type SingleLineMergeEditorHandle = {
  insertMergeTag: (tag: string, label?: string) => void
  focus: () => void
}

export type SingleLineMergeEditorProps = {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}

export const SingleLineMergeEditor = React.forwardRef<SingleLineMergeEditorHandle, SingleLineMergeEditorProps>(function SingleLineMergeEditor(
  { value, onChange, placeholder, className },
  forwardedRef,
) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [isEmpty, setIsEmpty] = useState(!value)

  // Re-seed when the external value identity changes (e.g. template picked).
  // We compare the serialised contenteditable content against `value` to
  // avoid overwriting the user's caret on every keystroke.
  useEffect(() => {
    if (!divRef.current) return
    const current = chipsToTokens(divRef.current.innerHTML).replace(/&nbsp;/g, ' ')
    if (current === value) return
    divRef.current.innerHTML = tokensToChips(value || '')
    setIsEmpty(!divRef.current.textContent)
  }, [value])

  const saveSelection = () => {
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel && sel.rangeCount > 0 && divRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    if (!savedRange.current || !divRef.current) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }

  const emitChange = () => {
    if (!divRef.current) return
    // Collapse <div> / <br> that contenteditable sometimes injects on edit,
    // since we want a strictly single-line value.
    const raw = chipsToTokens(divRef.current.innerHTML)
    const flattened = raw
      .replace(/<div[^>]*>/gi, '')
      .replace(/<\/div>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/&nbsp;/g, ' ')
    onChange(flattened)
    setIsEmpty(!divRef.current.textContent)
  }

  const insertChipAtCaret = (tag: string, label?: string) => {
    if (!divRef.current) return
    // Make sure the editor is focused so getSelection() refers to it.
    divRef.current.focus()
    restoreSelection()

    const sel = window.getSelection()
    let range: Range
    if (sel && sel.rangeCount > 0 && divRef.current.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0)
    } else {
      // No saved selection inside the editor — drop the chip at the end of
      // the current content. Better than nothing if the picker was clicked
      // before the user ever placed their caret.
      range = document.createRange()
      range.selectNodeContents(divRef.current)
      range.collapse(false)
    }

    // Build the chip + trailing non-breaking space as detached DOM nodes so
    // we can place the caret AFTER them deterministically (without relying on
    // execCommand's positioning behaviour).
    const chipWrapper = document.createElement('span')
    chipWrapper.innerHTML = makeChipHtml(tag, label)
    const chipEl = chipWrapper.firstElementChild as HTMLElement | null
    if (!chipEl) return
    const trailingSpace = document.createTextNode('\u00a0') // &nbsp;

    range.deleteContents()
    range.insertNode(trailingSpace)
    range.insertNode(chipEl)

    // Collapse selection to AFTER the trailing space so the user types
    // inline immediately after the chip.
    const after = document.createRange()
    after.setStartAfter(trailingSpace)
    after.collapse(true)
    sel?.removeAllRanges()
    sel?.addRange(after)

    saveSelection()
    emitChange()
  }

  React.useImperativeHandle(forwardedRef, () => ({
    insertMergeTag: (tag: string, label?: string) => insertChipAtCaret(tag, label),
    focus: () => divRef.current?.focus(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [onChange])

  return (
    <div className={`relative ${className ?? ''}`}>
      {isEmpty && placeholder && (
        <div className="absolute top-1/2 -translate-y-1/2 left-3 text-sm text-gray-400 pointer-events-none truncate max-w-[calc(100%-1.5rem)]">
          {placeholder}
        </div>
      )}
      <div
        ref={divRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={saveSelection}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onKeyDown={e => {
          // Swallow Enter so the subject stays single-line.
          if (e.key === 'Enter') {
            e.preventDefault()
          }
        }}
        onPaste={e => {
          // Force plaintext paste to avoid dragging in formatting / line breaks.
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ')
          try {
            // eslint-disable-next-line @typescript-eslint/no-deprecated
            document.execCommand('insertText', false, text)
          } catch {
            // fall through
          }
        }}
        className="min-h-[38px] w-full px-3 py-2 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-steps-blue-400 whitespace-nowrap overflow-x-auto"
        style={{ lineHeight: '22px' }}
      />
    </div>
  )
})
