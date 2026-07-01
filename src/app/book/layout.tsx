import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Book a call with the TSF Core Team · Steps Foundation',
  description: 'Book a 30-minute call with the Steps Foundation core team — includes a Google Meet link.',
}

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children
}
