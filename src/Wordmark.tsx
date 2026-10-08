// The name, closed with a square of ink.
export function Wordmark() {
  return (
    <span className="wordmark">
      retype
      <span className="seal" aria-hidden="true" />
    </span>
  )
}

export function ThemeToggle({ theme, onToggle }: { theme: 'light' | 'dark'; onToggle: () => void }) {
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button className="link" onClick={onToggle} aria-label={`Switch to the ${next} theme`}>
      {next === 'dark' ? 'Dark' : 'Light'}
    </button>
  )
}
