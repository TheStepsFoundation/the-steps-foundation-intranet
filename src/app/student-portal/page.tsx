import { redirect } from 'next/navigation'

// /student-portal was retired on 2026-04-19. The canonical student hub is now
// /my (sign-in at /my/sign-in). This server redirect preserves every deep link
// sent out in earlier event emails or saved in student bookmarks.
export default function StudentPortalRedirect() {
  redirect('/my')
}
