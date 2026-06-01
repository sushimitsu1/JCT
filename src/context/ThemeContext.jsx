import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

export const THEMES = {
  dark: {
    id: 'dark',
    label: 'Dark',
    emoji: '🌙',
    sidebar: '#111827',
    sidebarBorder: '#1F2937',
    sidebarText: '#9CA3AF',
    sidebarActiveText: '#fff',
    sidebarActiveBg: '#2563EB',
    sidebarHover: '#1F2937',
    logo: '#fff',
    logoSub: '#6B7280',
    header: '#111827',
    headerBorder: '#1F2937',
    headerText: '#D1D5DB',
    mainBg: '#030712',
    contentBg: '#111827',
    cardBg: '#111827',
    cardBorder: '#1F2937',
    text: '#F9FAFB',
    textMuted: '#9CA3AF',
    textSubtle: '#6B7280',
    inputBg: '#1F2937',
    inputBorder: '#374151',
    btnPrimary: '#2563EB',
    btnPrimaryHover: '#1D4ED8',
    btnPrimaryText: '#fff',
    accentText: '#60A5FA',
    signOutHover: '#F87171',
  },
  brand: {
    id: 'brand',
    label: 'JCT Brand',
    emoji: '🔵',
    sidebar: '#ffffff',
    sidebarBorder: '#E5E7EB',
    sidebarText: '#64748B',
    sidebarActiveText: '#C8102E',
    sidebarActiveBg: '#FEE2E2',
    sidebarHover: '#F8FAFC',
    logo: '#1B2A4A',
    logoSub: '#64748B',
    header: '#1B2A4A',
    headerBorder: '#1B2A4A',
    headerText: '#ffffff',
    mainBg: '#F8FAFC',
    contentBg: '#ffffff',
    cardBg: '#ffffff',
    cardBorder: '#E5E7EB',
    text: '#1B2A4A',
    textMuted: '#374151',
    textSubtle: '#64748B',
    inputBg: '#F8FAFC',
    inputBorder: '#D1D5DB',
    btnPrimary: '#2563EB',
    btnPrimaryHover: '#1D4ED8',
    btnPrimaryText: '#fff',
    accentText: '#2563EB',
    signOutHover: '#C8102E',
  },
  warm: {
    id: 'warm',
    label: 'Warm Green',
    emoji: '🌿',
    sidebar: '#1F2937',
    sidebarBorder: '#374151',
    sidebarText: '#9CA3AF',
    sidebarActiveText: '#fff',
    sidebarActiveBg: '#16A34A',
    sidebarHover: '#374151',
    logo: '#fff',
    logoSub: '#6B7280',
    header: '#ffffff',
    headerBorder: '#E5E7EB',
    headerText: '#374151',
    mainBg: '#F9FAFB',
    contentBg: '#ffffff',
    cardBg: '#ffffff',
    cardBorder: '#E5E7EB',
    text: '#111827',
    textMuted: '#374151',
    textSubtle: '#6B7280',
    inputBg: '#F9FAFB',
    inputBorder: '#D1D5DB',
    btnPrimary: '#16A34A',
    btnPrimaryHover: '#15803D',
    btnPrimaryText: '#fff',
    accentText: '#16A34A',
    signOutHover: '#F87171',
  }
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(() => {
    return localStorage.getItem('jct-theme') || 'dark'
  })

  const theme = THEMES[themeId] || THEMES.dark

  useEffect(() => {
    const saved = localStorage.getItem('jct-theme') || 'dark'
    document.body.className = saved === 'dark' ? '' : `theme-${saved}`
  }, [])

  const switchTheme = (id) => {
    setThemeId(id)
    localStorage.setItem('jct-theme', id)
    document.body.className = id === 'dark' ? '' : `theme-${id}`
  }

  return (
    <ThemeContext.Provider value={{ theme, themeId, switchTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}