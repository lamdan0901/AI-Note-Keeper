import React, { useMemo } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { type Theme, useTheme } from '../theme';

type WelcomeScreenProps = {
  onContinueLocal: () => void;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
};

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  onContinueLocal,
  onOpenLogin,
  onOpenRegister,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>AI Note Keeper</Text>
          <Text style={styles.title}>Start local, sign in when you need sync.</Text>
          <Text style={styles.subtitle}>
            Notes begin on this device. You can connect an account later without losing control of
            your data.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={onOpenRegister}>
            <Text style={styles.primaryText}>Create Account</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onOpenLogin}>
            <Text style={styles.secondaryText}>Sign In</Text>
          </Pressable>
        </View>

        <Pressable style={styles.localLink} onPress={onContinueLocal}>
          <Text style={styles.localLinkText}>Continue without account</Text>
        </Pressable>
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
    container: {
      flex: 1,
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.xl,
      paddingVertical: theme.spacing.xl,
    },
    hero: {
      gap: theme.spacing.md,
      marginTop: theme.spacing.xl,
    },
    eyebrow: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    title: {
      color: theme.colors.text,
      fontSize: 34,
      lineHeight: 40,
      fontWeight: '700',
      fontFamily: theme.typography.fontFamily,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.base,
      lineHeight: 24,
    },
    actions: {
      gap: theme.spacing.md,
    },
    primaryButton: {
      minHeight: 52,
      borderRadius: theme.borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    secondaryButton: {
      minHeight: 52,
      borderRadius: theme.borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    primaryText: {
      color: '#fff',
      fontSize: theme.typography.sizes.base,
      fontWeight: '700',
    },
    secondaryText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      fontWeight: '600',
    },
    localLink: {
      alignSelf: 'center',
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
    },
    localLinkText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      textDecorationLine: 'underline',
    },
  });
