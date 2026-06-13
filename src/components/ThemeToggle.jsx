import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

export default function ThemeToggle({ collapsed = false }) {
  const { themeId, toggleTheme } = useTheme()
  const isDark = themeId === 'sky-dark'
  const Icon = isDark ? Sun : Moon
  const nextLabel = isDark ? 'Light mode' : 'Dark mode'

  if (collapsed) {
    return (
      <button onClick={toggleTheme} title={`Switch to ${nextLabel}`}
        className="flex items-center justify-center w-10 h-10 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/60 transition-colors">
        <Icon size={16} />
      </button>
    )
  }

  return (
    <button onClick={toggleTheme}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800/60 transition-colors">
      <Icon size={15} />
      <span>{nextLabel}</span>
    </button>
  )
}
