import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Google Sheets export route — creates a brand-new spreadsheet from a
// header row + data matrix posted by the ExportButton, then (optionally)
// shares it back to the requesting admin's email so the returned link opens
// without a hello@ login.
//
// Environment variables required (set in Vercel):
//   GMAIL_CLIENT_ID              — Google Cloud OAuth2 client ID (shared with Gmail send)
//   GMAIL_CLIENT_SECRET          — Google Cloud OAuth2 client secret (shared with Gmail send)
//   GOOGLE_SHEETS_REFRESH_TOKEN  — offline refresh token for hello@thestepsfoundation.com
//                                  generated WITH these scopes:
//                                    https://www.googleapis.com/auth/spreadsheets
//                                    https://www.googleapis.com/auth/drive.file
//
// NB: the existing GMAIL_REFRESH_TOKEN only carries the mail scope, so it
// cannot create sheets. We fall back to it only so a missing env surfaces as
// a clear "insufficient scope" error rather than a generic config error.
// ---------------------------------------------------------------------------

const MAX_ROWS = 50_000
const MAX_COLS = 200
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function getAuth() {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_SHEETS_REFRESH_TOKEN || process.env.GMAIL_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Sheets export is not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GOOGLE_SHEETS_REFRESH_TOKEN (with the spreadsheets + drive.file scopes) in Vercel.',
    )
  }
  const oauth2 = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'https://developers.google.com/oauthplayground',
  )
  oauth2.setCredentials({ refresh_token: refreshToken })
  return oauth2
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      title?: unknown
      headers?: unknown
      rows?: unknown
      shareWith?: unknown
    }

    if (!Array.isArray(body.headers) || !Array.isArray(body.rows)) {
      return NextResponse.json({ error: 'headers and rows must be arrays' }, { status: 400 })
    }
    if (body.rows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Too many rows (${body.rows.length}); max ${MAX_ROWS}.` }, { status: 413 })
    }
    if (body.headers.length === 0) {
      return NextResponse.json({ error: 'At least one column is required.' }, { status: 400 })
    }
    if (body.headers.length > MAX_COLS) {
      return NextResponse.json({ error: `Too many columns; max ${MAX_COLS}.` }, { status: 413 })
    }

    const title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : 'Steps export'
    const headerRow = (body.headers as unknown[]).map(h => String(h ?? ''))
    const dataRows = (body.rows as unknown[]).map(r =>
      Array.isArray(r) ? r.map(c => (c == null ? '' : (c as string | number | boolean))) : [],
    )
    const shareWith =
      typeof body.shareWith === 'string' && EMAIL_RE.test(body.shareWith) ? body.shareWith : null

    const auth = getAuth()
    const sheets = google.sheets({ version: 'v4', auth })

    // 1. Create the spreadsheet shell with a frozen header row.
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
        sheets: [{ properties: { title: 'Data', gridProperties: { frozenRowCount: 1 } } }],
      },
    })
    const spreadsheetId = created.data.spreadsheetId
    if (!spreadsheetId) throw new Error('Sheet creation returned no spreadsheetId.')
    const spreadsheetUrl =
      created.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    const firstSheetId = created.data.sheets?.[0]?.properties?.sheetId ?? 0

    // 2. Write headers + data.
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Data!A1',
      valueInputOption: 'RAW',
      requestBody: { values: [headerRow, ...dataRows] },
    })

    // 3. Bold the header row.
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: { sheetId: firstSheetId, startRowIndex: 0, endRowIndex: 1 },
              cell: { userEnteredFormat: { textFormat: { bold: true } } },
              fields: 'userEnteredFormat.textFormat.bold',
            },
          },
        ],
      },
    })

    // 4. Share back to the requesting admin (best-effort; non-fatal).
    let shared = false
    if (shareWith) {
      try {
        const drive = google.drive({ version: 'v3', auth })
        await drive.permissions.create({
          fileId: spreadsheetId,
          sendNotificationEmail: false,
          requestBody: { type: 'user', role: 'writer', emailAddress: shareWith },
        })
        shared = true
      } catch (e) {
        console.error('export-sheet share failed:', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ url: spreadsheetUrl, title, shared })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('export-sheet error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
