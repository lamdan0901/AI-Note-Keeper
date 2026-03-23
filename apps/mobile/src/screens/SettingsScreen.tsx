import React, { useMemo } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';

const themeOptions = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
  { key: 'auto', label: 'Auto', icon: 'desktop-outline' },
] as const;

export const SettingsScreen: React.FC = () => {
  const { theme, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Theme</Text>
          <View style={styles.themeOptions}>
            {themeOptions.map((option) => {
              const isSelected = mode === option.key;
              return (
                <Pressable
                  key={option.key}
                  style={[styles.themeButton, isSelected && styles.themeButtonSelected]}
                  onPress={() => setMode(option.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`${option.label} theme`}
                  accessibilityState={{ selected: isSelected }}
                >
                  <Ionicons
                    name={option.icon}
                    size={22}
                    color={isSelected ? theme.colors.primary : theme.colors.textMuted}
                  />
                  <Text style={[styles.themeLabel, isSelected && styles.themeLabelSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    header: {
      padding: theme.spacing.md,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerTitle: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
    },
    content: {
      flex: 1,
      padding: theme.spacing.lg,
      gap: theme.spacing.lg,
    },
    section: {
      gap: theme.spacing.md,
    },
    sectionTitle: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    themeOptions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    themeButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    themeButtonSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.surface,
    },
    themeLabel: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontWeight: '500',
    },
    themeLabelSelected: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
  });
