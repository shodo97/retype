// Light or dark. It follows the system until the reader picks one, which is then remembered
// in this browser. index.html applies the same rule before first paint.
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'retype.theme'
const system = matchMedia('(prefers-color-scheme: dark)')

function resolve(): Theme {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return system.matches ? 'dark' : 'light'
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState(resolve)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const follow = () => setTheme(resolve())
    system.addEventListener('change', follow)
    return () => system.removeEventListener('change', follow)
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_KEY, next)
    setTheme(next)
  }

  return [theme, toggle]
}
