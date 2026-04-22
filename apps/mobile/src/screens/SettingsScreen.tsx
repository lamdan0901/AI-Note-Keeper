import React, { useMemo } from 'react';
import { Alert, ActivityIndicator } from 'react-native';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';

const themeOptions = [
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
  { key: 'auto', label: 'Auto', icon: 'desktop-outline' },
] as const;

type SettingsScreenProps = {
  isAuthenticated: boolean;
  username: string | null;
  signingOut?: boolean;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onSignOut: () => Promise<void>;
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  isAuthenticated,
  username,
  signingOut = false,
  onOpenLogin,
  onOpenRegister,
  onSignOut,
}) => {
  const { theme, mode, setMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const handleSignOut = () => {
    if (signingOut) {
      return;
    }

    Alert.alert('Sign Out', 'Sign out and switch back to local device account?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => {
          void onSignOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      <View style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.accountCard}>
            {isAuthenticated ? (
              <>
                <Text style={styles.accountPrimary}>Signed in as {username}</Text>
                <Pressable
                  style={[styles.signOutButton, signingOut && styles.signOutButtonDisabled]}
                  onPress={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? (
                    <View style={styles.signOutLoadingContent}>
                      <ActivityIndicator size="small" color={theme.colors.error} />
                      <Text style={styles.signOutButtonText}>Signing Out...</Text>
                    </View>
                  ) : (
                    <Text style={styles.signOutButtonText}>Sign Out</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.accountPrimary}>Local account</Text>
                <View style={styles.accountActions}>
                  <Pressable style={styles.accountActionButton} onPress={onOpenLogin}>
                    <Text style={styles.accountActionText}>Sign In</Text>
                  </Pressable>
                  <Pressable style={styles.accountActionButton} onPress={onOpenRegister}>
                    <Text style={styles.accountActionText}>Create Account</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>

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
    accountCard: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface,
      padding: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    accountPrimary: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '600',
    },
    accountSecondary: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
    },
    accountActions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
    },
    accountActionButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      backgroundColor: theme.colors.background,
    },
    accountActionText: {
      color: theme.colors.text,
      fontWeight: '600',
      fontSize: theme.typography.sizes.sm,
    },
    signOutButton: {
      borderWidth: 1,
      borderColor: theme.colors.error,
      borderRadius: theme.borderRadius.md,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      backgroundColor: theme.colors.background,
    },
    signOutButtonDisabled: {
      opacity: 0.7,
    },
    signOutLoadingContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.xs,
    },
    signOutButtonText: {
      color: theme.colors.error,
      fontWeight: '600',
      fontSize: theme.typography.sizes.sm,
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
