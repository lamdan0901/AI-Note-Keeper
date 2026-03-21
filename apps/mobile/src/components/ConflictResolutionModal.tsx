import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Note } from '../db/notesRepo';
import { type Theme, useTheme } from '../theme';

type ConflictResolutionModalProps = {
  visible: boolean;
  localNote: Note | null;
  serverNote: Note | null;
  loading?: boolean;
  onClose: () => void;
  onKeepLocal: () => void;
  onUseServer: () => void;
};

function renderText(value: string | null | undefined): string {
  if (!value || !value.trim()) return '(empty)';
  return value.trim();
}

export const ConflictResolutionModal: React.FC<ConflictResolutionModalProps> = ({
  visible,
  localNote,
  serverNote,
  loading = false,
  onClose,
  onKeepLocal,
  onUseServer,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!visible) return null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="warning" size={20} color={theme.colors.error} />
              <Text style={styles.title}>Resolve Conflict</Text>
            </View>
            <Pressable onPress={onClose} disabled={loading}>
              <Ionicons name="close" size={22} color={theme.colors.textMuted} />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            This note has concurrent edits. Choose which version to keep.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your local version</Text>
            <Text style={styles.previewTitle}>{renderText(localNote?.title)}</Text>
            <Text style={styles.previewBody}>{renderText(localNote?.content)}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Server version</Text>
            {serverNote ? (
              <>
                <Text style={styles.previewTitle}>{renderText(serverNote.title)}</Text>
                <Text style={styles.previewBody}>{renderText(serverNote.content)}</Text>
              </>
            ) : (
              <Text style={styles.missingServerText}>
                Server copy was not found. It may have been deleted.
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            <Pressable
              style={[styles.button, styles.buttonSecondary]}
              onPress={onUseServer}
              disabled={loading}
            >
              <Text style={styles.buttonSecondaryText}>
                {serverNote ? 'Use Server' : 'Accept Server Delete'}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.button, styles.buttonPrimary]}
              onPress={onKeepLocal}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Keep Mine</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: theme.spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 520,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    title: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: '700',
      color: theme.colors.text,
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    section: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    sectionLabel: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      fontWeight: '700',
    },
    previewTitle: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: '600',
    },
    previewBody: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    missingServerText: {
      color: theme.colors.error,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    button: {
      flex: 1,
      borderRadius: theme.borderRadius.md,
      paddingVertical: theme.spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 42,
    },
    buttonPrimary: {
      backgroundColor: theme.colors.primary,
    },
    buttonSecondary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface,
    },
    buttonPrimaryText: {
      color: '#ffffff',
      fontWeight: '700',
    },
    buttonSecondaryText: {
      color: theme.colors.text,
      fontWeight: '600',
    },
  });
