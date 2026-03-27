import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';
import { useAuth } from '../auth/AuthContext';

type LoginScreenProps = {
  onNavigateToRegister: () => void;
  onDismiss: () => void;
};

export const LoginScreen: React.FC<LoginScreenProps> = ({ onNavigateToRegister, onDismiss }) => {
  const { theme } = useTheme();
  const { login } = useAuth();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const result = await login(username.trim(), password);
      if (!result.success) {
        setError(result.error || 'Login failed');
      } else {
        onDismiss();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.closeButton} onPress={onDismiss}>
          <Ionicons name="close" size={24} color={theme.colors.textMuted} />
        </Pressable>

        <View style={styles.content}>
          <View style={styles.header}>
            <Ionicons name="person-circle-outline" size={64} color={theme.colors.primary} />
            <Text style={styles.title}>Sign In</Text>
            <Text style={styles.subtitle}>Sign in to sync your notes across devices</Text>
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Username"
              placeholderTextColor={theme.colors.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={theme.colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              onSubmitEditing={handleLogin}
            />

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don&apos;t have an account? </Text>
            <Pressable onPress={onNavigateToRegister} disabled={loading}>
              <Text style={styles.footerLink}>Create one</Text>
            </Pressable>
          </View>

          <Pressable style={styles.skipButton} onPress={onDismiss} disabled={loading}>
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
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
    },
    closeButton: {
      position: 'absolute',
      top: theme.spacing.md,
      right: theme.spacing.md,
      zIndex: 1,
      padding: theme.spacing.sm,
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.xl,
      gap: theme.spacing.lg,
    },
    header: {
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    title: {
      fontSize: theme.typography.sizes.xxl,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
    },
    subtitle: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      textAlign: 'center',
    },
    errorContainer: {
      backgroundColor: '#fee2e2',
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
    },
    errorText: {
      color: '#dc2626',
      fontSize: theme.typography.sizes.sm,
      textAlign: 'center',
    },
    form: {
      gap: theme.spacing.md,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
    },
    button: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: '#fff',
      fontSize: theme.typography.sizes.md,
      fontWeight: '600',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
    },
    footerText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
    },
    footerLink: {
      color: theme.colors.primary,
      fontSize: theme.typography.sizes.sm,
      fontWeight: '600',
    },
    skipButton: {
      alignSelf: 'center',
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
    },
    skipButtonText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      textDecorationLine: 'underline',
    },
  });
