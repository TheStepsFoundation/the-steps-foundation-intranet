'use client'

import { AuthProvider } from '@/lib/auth-provider'
import { DataProvider } from '@/lib/data-provider'
import { ThemeProvider } from '@/lib/theme-provider'
import { SetPasswordModal } from '@/components/SetPasswordModal'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <DataProvider>{children}</DataProvider>
        {/*
         * SetPasswordModal mounts globally inside AuthProvider so it can
         * see useAuth(). It self-gates on pathname (skips public routes)
         * and only renders when the signed-in user has no password set.
         */}
        <SetPasswordModal />
      </AuthProvider>
    </ThemeProvider>
  )
}
