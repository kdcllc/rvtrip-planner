import React, { useEffect, useState } from 'react';

import { ThemeContext } from './themeContext';
import type { Theme } from './themeContext';

const THEME_STORAGE_KEY = 'trip-planner-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    // Initialize from localStorage or default to 'light'
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return (stored === 'dark' || stored === 'light') ? stored : 'light';
  });

  // Apply theme to HTML element and persist to localStorage
  useEffect(() => {
    const htmlElement = document.documentElement;
    htmlElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
