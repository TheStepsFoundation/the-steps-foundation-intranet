#!/usr/bin/env node
/**
 * One-time script: updates the Supabase "Magic Link" email template
 * to send a TSF-branded 6-digit OTP code instead of a magic link.
 *
 * Usage:
 *   1. Go to https://supabase.com/dashboard/account/tokens
 *   2. Generate an access token
 *   3. Run: SUPABASE_ACCESS_TOKEN=sbp_xxxxx node scripts/update-supabase-email-template.mjs
 *
 * This only needs to be run once.
 */

const PROJECT_REF = 'rvspshqltnyormiqaidx'
const API_BASE = 'https://api.supabase.com/v1'

const token = process.env.SUPABASE_ACCESS_TOKEN
if (!token) {
  console.error('Missing SUPABASE_ACCESS_TOKEN. Get one from https://supabase.com/dashboard/account/tokens')
  process.exit(1)
}

const MAGIC_LINK_SUBJECT = 'Your Steps Foundation verification code'

const MAGIC_LINK_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7f4;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1e1e2e;padding:28px 32px;text-align:center;">
              <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">The Steps Foundation</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 20px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e1e2e;">Your verification code</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.5;">Enter this code on the application page to verify your email address:</p>
              <!-- OTP Code -->
              <div style="background-color:#f3f0ff;border:2px solid #7c3aed;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
                <span style="font-size:36px;font-weight:700;color:#7c3aed;letter-spacing:8px;font-family:'Courier New',Courier,monospace;">{{ .Token }}</span>
              </div>
              <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;line-height:1.5;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">
                <em>Virtus non origo</em> &#8212; Character, not origin<br>
                <a href="https://thestepsfoundation.com" style="color:#7c3aed;text-decoration:none;">thestepsfoundation.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

const CONFIRM_SUBJECT = 'Confirm your Steps Foundation account'

const CONFIRM_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f8f7f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f7f4;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#1e1e2e;padding:28px 32px;text-align:center;">
              <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.5px;">The Steps Foundation</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 20px;">
              <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e1e2e;">Confirm your email</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.5;">Enter this code to confirm your account:</p>
              <!-- OTP Code -->
              <div style="background-color:#f3f0ff;border:2px solid #7c3aed;border-radius:12px;padding:20px;text-align:center;margin-bottom:28px;">
                <span style="font-size:36px;font-weight:700;color:#7c3aed;letter-spacing:8px;font-family:'Courier New',Courier,monospace;">{{ .Token }}</span>
              </div>
              <p style="margin:0 0 6px;font-size:13px;color:#9ca3af;line-height:1.5;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;line-height:1.5;">
                <em>Virtus non origo</em> &#8212; Character, not origin<br>
                <a href="https://thestepsfoundation.com" style="color:#7c3aed;text-decoration:none;">thestepsfoundation.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

async function main() {
  console.log('Updating Supabase email templates for project:', PROJECT_REF)

  const payload = {
    // Magic Link template → now sends OTP code
    mailer_subjects_magic_link: MAGIC_LINK_SUBJECT,
    mailer_templates_magic_link_content: MAGIC_LINK_TEMPLATE,
    // Confirmation template → also OTP-based
    mailer_subjects_confirmation: CONFIRM_SUBJECT,
    mailer_templates_confirmation_content: CONFIRM_TEMPLATE,
  }

  const res = await fetch(`${API_BASE}/projects/${PROJECT_REF}/config/auth`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`Failed (${res.status}):`, body)
    process.exit(1)
  }

  const data = await res.json()
  console.log('Success! Templates updated.')
  console.log('  Magic Link subject:', data.mailer_subjects_magic_link)
  console.log('  Confirmation subject:', data.mailer_subjects_confirmation)
  console.log('')
  console.log('Students will now receive a branded 6-digit OTP code instead of a magic link.')
}

main().catch(err => { console.error(err); process.exit(1) })
