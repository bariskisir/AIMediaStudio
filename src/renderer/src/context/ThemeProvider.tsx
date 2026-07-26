/**
 * Resolves system/user theme preferences and synchronizes CSS and native window chrome.
 */

import type { PropsWithChildren } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import { createLogger } from '@renderer/services/LoggerService'
import { useAppSelector } from '@renderer/store'

type ResolvedTheme = Exclude<ThemeMode, 'system'>

interface ThemeContextValue {
  theme: ResolvedTheme
  configuredTheme: ThemeMode
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  configuredTheme: 'system',
})
const logger = createLogger('ThemeProvider')

/** Supplies the resolved theme to Ant Design and styled components. */
export const ThemeProvider = ({ children }: PropsWithChildren): React.JSX.Element => {
  const configuredTheme = useAppSelector((state) => state.app.settings.theme)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  )
  const theme = configuredTheme === 'system' ? systemTheme : configuredTheme

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    /** Applies operating-system theme changes while system mode is selected. */
    const handleChange = (event: MediaQueryListEvent): void => {
      setSystemTheme(event.matches ? 'dark' : 'light')
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    document.body.setAttribute('theme-mode', theme)
    document.documentElement.style.colorScheme = theme
    void window.app.setTheme(theme).catch((error: unknown) => {
      logger.warn('Native title-bar theme could not be synchronized.', error)
    })
  }, [theme])

  const value = useMemo(() => ({ theme, configuredTheme }), [theme, configuredTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/** Returns the active and configured theme values. */
export const useTheme = (): ThemeContextValue => useContext(ThemeContext)
