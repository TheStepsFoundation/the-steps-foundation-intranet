/**
 * Tiny allowlist-based HTML sanitiser for user-authored rich text in the
 * form-builder page description. We only accept a short allowlist of inline
 * tags plus <a>, strip everything else, and force <a> to open in a new tab
 * with rel="noopener noreferrer". Any href that isn't http/https/mailto is
 * dropped so we never render javascript: or data: URIs.
 *
 * We intentionally do NOT pull in DOMPurify — the input surface is tiny
 * (admin-authored page title/description) and the allowlist is short. Keep
 * this file dependency-free so it works in both client and server bundles.
 */

const ALLOWED_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'U', 'BR', 'SPAN', 'DIV', 'P',
])

const ALLOWED_ATTRS_BY_TAG: Record<string, Set<string>> = {
  A: new Set(['href', 'target', 'rel']),
}

const SAFE_URL = /^(https?:|mailto:)/i

function cleanNode(node: Element) {
  // Strip disallowed tags by replacing them with their text content.
  if (!ALLOWED_TAGS.has(node.tagName)) {
    const text = node.textContent ?? ''
    node.replaceWith(document.createTextNode(text))
    return
  }

  // Strip disallowed attributes.
  const allowedAttrs = ALLOWED_ATTRS_BY_TAG[node.tagName] ?? new Set<string>()
  const toRemove: string[] = []
  for (const attr of Array.from(node.attributes)) {
    if (!allowedAttrs.has(attr.name.toLowerCase())) {
      toRemove.push(attr.name)
    }
  }
  toRemove.forEach(n => node.removeAttribute(n))

  // <a> rules: href must be http/https/mailto, force target=_blank rel=noopener
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (!SAFE_URL.test(href.trim())) {
      // Not a safe URL — drop the anchor but keep its text content.
      const text = node.textContent ?? ''
      node.replaceWith(document.createTextNode(text))
      return
    }
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }

  // Recurse through children (snapshot first — we mutate live).
  const children = Array.from(node.children)
  children.forEach(cleanNode)
}

/**
 * Sanitise an HTML string against the allowlist. In SSR contexts (no DOM)
 * we fall back to stripping all tags, which is safe but plain text.
 */
export function sanitizeRichHtml(raw: string | null | undefined): string {
  if (!raw) return ''
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return raw.replace(/<[^>]+>/g, '')
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<!doctype html><body>${raw}</body>`, 'text/html')
  const body = doc.body
  const topLevel = Array.from(body.children)
  topLevel.forEach(cleanNode)
  return body.innerHTML
}

export function looksLikeHtml(s: string | null | undefined): boolean {
  if (!s) return false
  return /<\/?[a-z][^>]*>/i.test(s)
}

/**
 * Strip HTML to plain text for contexts where markup would be invalid
 * (e.g. inside a card that's already wrapped in an anchor) or unwanted
 * (e.g. truncated previews). SSR fallback: regex strips tags.
 */
export function stripToText(raw: string | null | undefined): string {
  if (!raw) return ''
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return raw.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<!doctype html><body>${raw}</body>`, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}
