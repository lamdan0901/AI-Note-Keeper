import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance, Animated, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'auto';

const storageKey = 'theme-mode';

const baseTokens = {
  typography: {
    fontFamily: 'Plus Jakarta Sans',
    sizes: {
      xs: 12,
      sm: 14,
      base: 16,
      lg: 20,
      xl: 24,
      xxl: 32,
    },
    weights: {
      light: '300',
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  borderRadius: {
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  shadows: {
    sm: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 1.0,
      elevation: 1,
    },
    md: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 5,
    },
  },
};

const lightColors = {
  primary: '#3B82F6',
  secondary: '#60A5FA',
  cta: '#F97316',
  background: '#F8FAFC',
  text: '#1E293B',
  textMuted: '#475569',
  border: '#E2E8F0',
  surface: '#FFFFFF',
  success: '#22c55e',
  error: '#ef4444',
};

const darkColors = {
  primary: '#60A5FA',
  secondary: '#3B82F6',
  cta: '#F97316',
  background: '#0F172A',
  text: '#F8FAFC',
  textMuted: '#ccd0d7ff',
  border: '#334155',
  surface: '#1E293B',
  success: '#4ADE80',
  error: '#F87171',
};

const buildTheme = (colors: typeof lightColors) => ({
  colors,
  ...baseTokens,
});

export type Theme = ReturnType<typeof buildTheme>;

type ThemeContextValue = {
  theme: Theme;
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('auto');
  const [systemScheme, setSystemScheme] = useState<'light' | 'dark'>(
    Appearance.getColorScheme() === 'dark' ? 'dark' : 'light',
  );
  const transitionOpacity = useRef(new Animated.Value(0)).current;
  const [transitionColor, setTransitionColor] = useState(lightColors.background);
  const prevThemeRef = useRef<Theme>(buildTheme(lightColors));

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (stored === 'light' || stored === 'dark' || stored === 'auto') {
          setMode(stored);
        }
      } catch (e) {
        return;
      }
    };
    void load();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(storageKey, mode).catch(() => {});
  }, [mode]);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => subscription.remove();
  }, []);

  const resolvedMode = mode === 'auto' ? systemScheme : mode;
  const theme = useMemo(
    () => buildTheme(resolvedMode === 'dark' ? darkColors : lightColors),
    [resolvedMode],
  );

  // Push the app's resolved theme into the native layer so native components
  // (DateTimePicker dialogs, splash screen on next launch) match the in-app theme.
  useEffect(() => {
    if (mode === 'auto') {
      // Revert to system default — let the OS control native UI mode
      Appearance.setColorScheme(null);
    } else {
      Appearance.setColorScheme(resolvedMode);
    }
  }, [mode, resolvedMode]);

  useEffect(() => {
    const previous = prevThemeRef.current;
    if (previous.colors.background !== theme.colors.background) {
      setTransitionColor(previous.colors.background);
      transitionOpacity.setValue(1);
      Animated.timing(transitionOpacity, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }).start();
    }
    prevThemeRef.current = theme;
  }, [theme, transitionOpacity]);

  const value = useMemo(
    () => ({
      theme,
      mode,
      resolvedMode,
      setMode,
    }),
    [theme, mode, resolvedMode],
  );

  return React.createElement(
    ThemeContext.Provider,
    { value },
    React.createElement(
      View,
      { style: [styles.provider, { backgroundColor: theme.colors.background }] },
      children,
      React.createElement(Animated.View, {
        pointerEvents: 'none',
        style: [
          StyleSheet.absoluteFillObject,
          { backgroundColor: transitionColor, opacity: transitionOpacity },
        ],
      }),
    ),
  );
};

export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (value) {
    return value;
  }
  return {
    theme: buildTheme(lightColors),
    mode: 'light' as ThemeMode,
    resolvedMode: 'light' as const,
    setMode: () => {},
  };
};

const styles = StyleSheet.create({
  provider: {
    flex: 1,
  },
});

export const lightTheme = buildTheme(lightColors);
export const darkTheme = buildTheme(darkColors);
