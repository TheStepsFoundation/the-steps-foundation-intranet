'use client'

import { DataProvider } from '@/lib/data-provider'

export function Providers({ children }: { children: React.ReactNode }) {
  return <DataProvider>{children}</DataProvider>
}
