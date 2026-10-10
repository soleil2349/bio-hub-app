/**
 * Light / dark / system appearance.
 *
 * Palettes live in `theme.ts`. This module only decides which one is active
 * and persists the choice. Components must read colours through `useTheme()`:
 * a StyleSheet created at module load keeps the first palette forever.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  darkPalette,
  darkVital,
  lightPalette,
  lightVital,
  type Palette,
  type VitalPalette,
} from './theme';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = '@biohub_theme';

type ThemeValue = {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  color: Palette;
  vital: VitalPalette;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

function isMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (isMode(stored)) setModeState(stored);
      })
      .catch(() => {});
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const resolved: 'light' | 'dark' =
    mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;

  const value = useMemo<ThemeValue>(
    () => ({
      mode,
      resolved,
      color: resolved === 'dark' ? darkPalette : lightPalette,
      vital: resolved === 'dark' ? darkVital : lightVital,
      setMode,
    }),
    [mode, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

/** Rebuild a stylesheet when the active palette changes. `factory` must be a stable function. */
export function useThemedStyles<T>(factory: (color: Palette) => T): T {
  const { color } = useTheme();
  return useMemo(() => factory(color), [color, factory]);
}
