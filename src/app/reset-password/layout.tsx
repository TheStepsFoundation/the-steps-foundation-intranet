import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Reset password — The Steps Foundation',
  description: 'Set a new password for your Steps Foundation account.',
}

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
