import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'of_theme';
const listeners = new Set<() => void>();

export function getTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'light';
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  applyTheme(t);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}

// Subscribe a component to theme changes.
export function useTheme(): Theme {
  const [t, setT] = useState<Theme>(getTheme());
  useEffect(() => {
    const l = () => setT(getTheme());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return t;
}
