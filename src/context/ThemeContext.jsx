import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext()

export const THEMES = {
  'sky-dark': {
    id: 'sky-dark',
    label: 'Dark',
    emoji: '🌙',
    sidebar: '#18181B',
    sidebarBorder: '#27272A',
    sidebarText: '#A1A1AA',
    sidebarActiveText: '#FFFFFF',
    sidebarActiveBg: '#0284C7',
    sidebarHover: '#27272A',
    logo: '#FAFAFA',
    logoSub: '#71717A',
    header: '#18181B',
    headerBorder: '#27272A',
    headerText: '#FAFAFA',
    mainBg: '#09090B',
    contentBg: '#18181B',
    cardBg: '#18181B',
    cardBorder: '#27272A',
    text: '#FAFAFA',
    textMuted: '#A1A1AA',
    textSubtle: '#71717A',
    inputBg: '#27272A',
    inputBorder: '#3F3F46',
    btnPrimary: '#0284C7',
    btnPrimaryHover: '#0369A1',
    btnPrimaryText: '#FFFFFF',
    accentText: '#38BDF8',
    signOutHover: '#F87171',
  },
  'sky-light': {
    id: 'sky-light',
    label: 'Light',
    emoji: '☀️',
    sidebar: '#FFFFFF',
    sidebarBorder: '#E4E4E7',
    sidebarText: '#52525B',
    sidebarActiveText: '#FFFFFF',
    sidebarActiveBg: '#0284C7',
    sidebarHover: '#F4F4F5',
    logo: '#18181B',
    logoSub: '#71717A',
    header: '#FFFFFF',
    headerBorder: '#E4E4E7',
    headerText: '#18181B',
    mainBg: '#FAFAFA',
    contentBg: '#FFFFFF',
    cardBg: '#FFFFFF',
    cardBorder: '#E4E4E7',
    text: '#18181B',
    textMuted: '#52525B',
    textSubtle: '#71717A',
    inputBg: '#FFFFFF',
    inputBorder: '#D4D4D8',
    btnPrimary: '#0284C7',
    btnPrimaryHover: '#0369A1',
    btnPrimaryText: '#FFFFFF',
    accentText: '#0284C7',
    signOutHover: '#DC2626',
  },
}

// Apply theme class before React renders to prevent flash of wrong mode
const initialThemeId = (() => {
  if (typeof window === 'undefined') return 'sky-dark'
  const saved = localStorage.getItem('jct-theme')
  // Migrate old theme ids
  if (!saved || !THEMES[saved]) return 'sky-dark'
  return saved
})()
if (typeof document !== 'undefined') {
  document.documentElement.classList.remove('theme-sky-dark', 'theme-sky-light')
  document.documentElement.classList.add(`theme-${initialThemeId}`)
}

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(initialThemeId)

  const applyTheme = (id) => {
    const t = THEMES[id] || THEMES['sky-dark']
    const root = document.documentElement

    // Set legacy CSS vars (used by inline styles in components)
    root.style.setProperty('--theme-bg', t.mainBg)
    root.style.setProperty('--theme-surface', t.cardBg)
    root.style.setProperty('--theme-border', t.cardBorder)
    root.style.setProperty('--theme-text', t.text)
    root.style.setProperty('--theme-muted', t.textMuted)
    root.style.setProperty('--theme-subtle', t.textSubtle)
    root.style.setProperty('--theme-input-bg', t.inputBg)
    root.style.setProperty('--theme-input-border', t.inputBorder)
    root.style.setProperty('--theme-sidebar', t.sidebar)
    root.style.setProperty('--theme-sidebar-border', t.sidebarBorder)

    // Toggle html class — drives Tailwind palette flip
    root.classList.remove('theme-sky-dark', 'theme-sky-light')
    root.classList.add(`theme-${t.id}`)

    document.body.style.backgroundColor = t.mainBg
    document.body.style.color = t.text
  }

  useEffect(() => { applyTheme(themeId) }, [themeId])

  const switchTheme = (id) => {
    if (!THEMES[id]) return
    setThemeId(id)
    localStorage.setItem('jct-theme', id)
  }

  const toggleTheme = () => {
    switchTheme(themeId === 'sky-dark' ? 'sky-light' : 'sky-dark')
  }

  const theme = THEMES[themeId] || THEMES['sky-dark']

  return (
    <ThemeContext.Provider value={{ theme, themeId, switchTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
