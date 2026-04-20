"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Contenteditable input/textarea that supports inserting hyperlinks via Ctrl+K
 * (or Cmd+K). The rendered HTML is returned via `onChange` as a string; the
 * consumer should run it through `sanitizeRichHtml` on render.
 *
 * Two modes:
 *   - single-line (default): Enter is swallowed; behaves like an <input>.
 *   - multiline (pass `multiline`): Enter inserts a line break; behaves like
 *     a <textarea>. Auto-grows with content.
 *
 * The Ctrl+K behaviour is deliberately silent — there is no visible hint or
 * button. Admins who know the shortcut use it; everyone else continues to
 * type plain text and gets plain text.
 */

type Props = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  className?: string
  ariaLabel?: string
  multiline?: boolean
  rows?: number
}

const baseInputClass =
  "w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-md text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-steps-blue-500"

export default function LinkableInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  multiline = false,
  rows = 3,
}: Props) {
  const editorRef = useRef<HTMLDivElement | null>(null)
  const savedRangeRef = useRef<Range | null>(null)
  const [showLinkPrompt, setShowLinkPrompt] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")
  const [linkText, setLinkText] = useState("")
  const [isEditingExisting, setIsEditingExisting] = useState(false)

  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    if (el.innerHTML !== value) {
      el.innerHTML = value ?? ""
    }
  }, [value])

  const emit = () => {
    const el = editorRef.current
    if (!el) return
    onChange(el.innerHTML)
  }

  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
  }

  const restoreSelection = () => {
    const range = savedRangeRef.current
    if (!range) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(range)
  }

  const findAncestorAnchor = (node: Node | null): HTMLAnchorElement | null => {
    let cur: Node | null = node
    while (cur && cur !== editorRef.current) {
      if ((cur as HTMLElement).tagName === "A") return cur as HTMLAnchorElement
      cur = cur.parentNode
    }
    return null
  }

  const openLinkPrompt = () => {
    saveSelection()
    const sel = window.getSelection()
    const range = savedRangeRef.current
    const selectedText = range ? range.toString() : ""

    const anchor = range ? findAncestorAnchor(range.startContainer) : null

    if (anchor) {
      setIsEditingExisting(true)
      setLinkUrl(anchor.getAttribute("href") ?? "")
      setLinkText(anchor.textContent ?? "")
    } else {
      setIsEditingExisting(false)
      setLinkUrl("")
      setLinkText(selectedText || "")
    }

    setShowLinkPrompt(true)
    setTimeout(() => {
      const el = document.getElementById("linkable-input-url") as HTMLInputElement | null
      el?.focus()
      el?.select()
    }, 10)
    void sel
  }

  const confirmLink = () => {
    const el = editorRef.current
    if (!el) return
    const url = linkUrl.trim()
    const text = (linkText.trim() || url)

    if (!url) {
      setShowLinkPrompt(false)
      return
    }

    let safeUrl = url
    if (!/^(https?:|mailto:)/i.test(safeUrl)) {
      safeUrl = "https://" + safeUrl
    }

    el.focus()
    restoreSelection()

    if (isEditingExisting && savedRangeRef.current) {
      const anchor = findAncestorAnchor(savedRangeRef.current.startContainer)
      if (anchor) {
        anchor.setAttribute("href", safeUrl)
        anchor.setAttribute("target", "_blank")
        anchor.setAttribute("rel", "noopener noreferrer")
        anchor.textContent = text
      }
    } else {
      const range = savedRangeRef.current
      if (range) {
        range.deleteContents()
        const a = document.createElement("a")
        a.setAttribute("href", safeUrl)
        a.setAttribute("target", "_blank")
        a.setAttribute("rel", "noopener noreferrer")
        a.textContent = text
        range.insertNode(a)

        const after = document.createRange()
        after.setStartAfter(a)
        after.collapse(true)
        const sel = window.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(after)
      }
    }

    setShowLinkPrompt(false)
    emit()
  }

  const removeLink = () => {
    const el = editorRef.current
    if (!el) return
    const range = savedRangeRef.current
    const anchor = range ? findAncestorAnchor(range.startContainer) : null
    if (anchor) {
      const text = document.createTextNode(anchor.textContent ?? "")
      anchor.replaceWith(text)
      emit()
    }
    setShowLinkPrompt(false)
  }

  const cancelLink = () => {
    setShowLinkPrompt(false)
    editorRef.current?.focus()
    restoreSelection()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault()
      openLinkPrompt()
      return
    }
    if (!multiline && e.key === "Enter") {
      e.preventDefault()
      return
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData("text/plain")
    document.execCommand("insertText", false, text)
  }

  const editorStyle: React.CSSProperties = multiline
    ? { minHeight: `${rows * 1.6}em`, whiteSpace: "pre-wrap" }
    : { minHeight: "1.9em", whiteSpace: "pre-wrap" }

  return (
    <div className="relative">
      <div
        ref={editorRef}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline ? "true" : "false"}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        data-placeholder={placeholder}
        className={`${baseInputClass} ${className ?? ""} linkable-input`}
        style={editorStyle}
      />

      {showLinkPrompt && (
        <div
          className="absolute z-20 mt-1 left-0 right-0 p-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg space-y-1"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-gray-500 w-12">Text</label>
            <input
              value={linkText}
              onChange={(e) => setLinkText(e.target.value)}
              placeholder="Link text"
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-900"
            />
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-gray-500 w-12">URL</label>
            <input
              id="linkable-input-url"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  confirmLink()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  cancelLink()
                }
              }}
              className="flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-900"
            />
          </div>
          <div className="flex items-center gap-1 justify-end pt-1">
            {isEditingExisting && (
              <button
                type="button"
                onClick={removeLink}
                className="px-2 py-0.5 text-[11px] text-red-600 hover:underline"
              >
                Remove link
              </button>
            )}
            <button
              type="button"
              onClick={cancelLink}
              className="px-2 py-0.5 text-[11px] text-gray-500 hover:underline"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmLink}
              className="px-2 py-0.5 text-[11px] bg-steps-blue-600 text-white rounded hover:bg-steps-blue-700"
            >
              {isEditingExisting ? "Update" : "Add link"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
