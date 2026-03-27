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

type RegisterScreenProps = {
  onNavigateToLogin: () => void;
  onDismiss: () => void;
};

export const RegisterScreen: React.FC<RegisterScreenProps> = ({
  onNavigateToLogin,
  onDismiss,
}) => {
  const { theme } = useTheme();
  const { register } = useAuth();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError(null);

    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
      setError('Username must be 3-30 characters, letters, numbers, and underscores only');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const result = await register(username.trim(), password);
      if (!result.success) {
        setError(result.error || 'Registration failed');
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
            <Ionicons name="person-add-outline" size={64} color={theme.colors.primary} />
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>
              Create an account to sync your notes across devices
            </Text>
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
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm Password"
              placeholderTextColor={theme.colors.textMuted}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
              onSubmitEditing={handleRegister}
            />

            <Pressable
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Create Account</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Pressable onPress={onNavigateToLogin} disabled={loading}>
              <Text style={styles.footerLink}>Sign in</Text>
            </Pressable>
          </View>
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
  });
