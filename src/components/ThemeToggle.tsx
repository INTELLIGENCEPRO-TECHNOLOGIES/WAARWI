import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemeMode } from '../context/ThemeContext';

const MODES: { key: ThemeMode; icon: typeof Sun; label: string }[] = [
  { key: 'light', icon: Sun, label: 'Clair' },
  { key: 'dark', icon: Moon, label: 'Sombre' },
  { key: 'system', icon: Monitor, label: 'Système' },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--w-hover)]">
      {MODES.map(m => {
        const Icon = m.icon;
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              active
                ? 'bg-[var(--w-surface)] text-[var(--w-text)] shadow-sm'
                : 'text-[var(--w-text-muted)] hover:text-[var(--w-text-sec)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CompactThemeToggle() {
  const { mode, setMode } = useTheme();
  const next: ThemeMode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const Icon = mode === 'dark' ? Moon : mode === 'system' ? Monitor : Sun;
  const label = mode === 'dark' ? 'Sombre' : mode === 'system' ? 'Système' : 'Clair';
  return (
    <button
      onClick={() => setMode(next)}
      className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 flex items-center gap-2 transition-colors"
    >
      <Icon className="w-4 h-4 text-neutral-400" />
      <span>Thème: {label}</span>
    </button>
  );
}
