/**
 * Shared MIME builder for outgoing Gmail API sends.
 *
 * Used by both /api/send-email (one-by-one from invite modal) and
 * /api/process-email-queue (bulk decision-send worker) so the envelope stays
 * byte-compatible between flows.
 *
 * When attachments are present, the root envelope is multipart/mixed wrapping
 * a multipart/alternative part (text + html) followed by N file parts. When
 * there are no attachments we stay on multipart/alternative to keep the
 * simpler envelope that was in place before attachments existed.
 */
export type EmailAttachment = {
  /** Public Supabase storage URL; fetched and base64-encoded server-side. */
  url: string
  filename: string
  mime_type: string
  size_bytes: number
}

const FROM_EMAIL = 'events@thestepsfoundation.com'
const FROM_NAME = 'Events - The Steps Foundation'

// Hard ceiling per attachment (Gmail's total message cap is 25MB including
// base64 overhead; 20MB raw leaves headroom for the body + encoding bloat).
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

/** Fold a base64 string to 76-char lines so it stays RFC 2045-compliant. */
function foldBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64
}

/** Base64-encode an attachment filename for MIME Content-Disposition. */
function encodeFilename(name: string): string {
  // RFC 2047 encoded-word for filenames with non-ASCII / special chars
  if (/^[\x20-\x7e]+$/.test(name) && !name.includes('"')) return name
  return `=?UTF-8?B?${Buffer.from(name, 'utf8').toString('base64')}?=`
}

async function fetchAttachmentBytes(att: EmailAttachment): Promise<Buffer> {
  const res = await fetch(att.url)
  if (!res.ok) {
    throw new Error(`Attachment fetch failed (${res.status}) for ${att.filename}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength > ATTACHMENT_MAX_BYTES) {
    throw new Error(`Attachment "${att.filename}" is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — max ${ATTACHMENT_MAX_BYTES / 1024 / 1024}MB.`)
  }
  return buf
}


/**
 * Wrap the composed HTML body in a fixed-width container so the sent email
 * renders at the same line-length as the in-app preview. Email clients do
 * not apply any default max-width, so without this the text stretches edge-
 * to-edge and becomes hard to read.
 *
 * 600px is the industry-standard email width — matches Mailchimp, Gmail's
 * own newsletter width, and is a comfortable ~75ch at 14px. Wider than the
 * 508px signature table, so the signature still sits inside comfortably.
 *
 * The outer table (with role="presentation") is the Outlook-safe way of
 * centring content; many Outlook versions ignore margin:auto on divs.
 */
export function wrapHtmlForEmail(innerHtml: string, unsubscribeUrl?: string): string {
  const footer = unsubscribeUrl
    ? [
        '<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e5e5;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#888;text-align:center">',
        'You\'re receiving this because you\'re on The Steps Foundation mailing list. ',
        `<a href="${unsubscribeUrl}" style="color:#888;text-decoration:underline">Unsubscribe</a>`,
        '</div>',
      ].join('')
    : ''
  return [
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:transparent">',
    '<tr><td align="left" style="padding:0">',
    '<div style="max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">',
    innerHtml,
    footer,
    '</div>',
    '</td></tr>',
    '</table>',
  ].join('')
}

export type BuildRawEmailOpts = {
  to: string
  subject: string
  htmlBody: string
  attachments?: EmailAttachment[] | null
  /**
   * Absolute URL the recipient can click to unsubscribe. When provided:
   *   - A visible "Unsubscribe" footer is appended to the HTML body.
   *   - List-Unsubscribe and List-Unsubscribe-Post headers are added so
   *     Gmail/Yahoo render the native "Unsubscribe" chip (RFC 2369/8058).
   * Required for Google bulk-sender compliance (>5k/day threshold).
   */
  unsubscribeUrl?: string
}

/**
 * Build the URL-safe base64 payload that Gmail's users.messages.send expects
 * in requestBody.raw. Fetches any attachments, base64-encodes them, and
 * wraps everything in the appropriate MIME structure.
 */
export async function buildRawEmail(opts: BuildRawEmailOpts): Promise<string> {
  const { to, subject } = opts
  const htmlBody = wrapHtmlForEmail(opts.htmlBody, opts.unsubscribeUrl)
  const attachments = (opts.attachments ?? []).filter(Boolean)

  const fromHeader = `${FROM_NAME} <${FROM_EMAIL}>`
  const headers = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
  ]
  if (opts.unsubscribeUrl) {
    // RFC 2369 visible-to-client link + RFC 8058 one-click POST support.
    // Gmail inspects both before showing its native unsubscribe chip.
    headers.push(`List-Unsubscribe: <${opts.unsubscribeUrl}>`)
    headers.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click')
  }

  // Inner alternative part — text/plain + text/html
  const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const altLines = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(htmlBody.replace(/<[^>]+>/g, ''), 'utf8').toString('base64')),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    foldBase64(Buffer.from(htmlBody, 'utf8').toString('base64')),
    '',
    `--${altBoundary}--`,
  ]

  let rawLines: string[]

  if (attachments.length === 0) {
    // Pure alternative — same shape the pre-attachment code produced.
    rawLines = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altLines,
    ]
  } else {
    // Fetch all attachment bodies in parallel so slow storage reads don't
    // serialise send latency.
    const fetched = await Promise.all(
      attachments.map(async att => ({ att, buf: await fetchAttachmentBytes(att) })),
    )

    const mixedBoundary = `mix_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const attachmentParts: string[] = []
    for (const { att, buf } of fetched) {
      const safeName = encodeFilename(att.filename)
      const mime = att.mime_type || 'application/octet-stream'
      attachmentParts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${mime}; name="${safeName}"`,
        `Content-Disposition: attachment; filename="${safeName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        foldBase64(buf.toString('base64')),
        '',
      )
    }

    rawLines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altLines,
      '',
      ...attachmentParts,
      `--${mixedBoundary}--`,
    ]
  }

  const raw = rawLines.join('\r\n')
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Runtime type guard for attachments coming off the wire (JSON payload) or
 * out of the JSONB column. Drops anything not shaped right rather than
 * throwing, since we'd rather send an email without a malformed attachment
 * than fail the whole send.
 */
export function sanitiseAttachments(input: unknown): EmailAttachment[] {
  if (!Array.isArray(input)) return []
  const out: EmailAttachment[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const url = typeof r.url === 'string' ? r.url : null
    const filename = typeof r.filename === 'string' ? r.filename : null
    const mimeType = typeof r.mime_type === 'string' ? r.mime_type : 'application/octet-stream'
    const sizeBytes = typeof r.size_bytes === 'number' ? r.size_bytes : 0
    if (!url || !filename) continue
    if (!/^https?:\/\//i.test(url)) continue
    out.push({ url, filename, mime_type: mimeType, size_bytes: sizeBytes })
  }
  return out
}
