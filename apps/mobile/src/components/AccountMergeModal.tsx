import React, { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { MergeSummary } from '../../../../packages/shared/auth/userDataMerge';
import { type Theme, useTheme } from '../theme';

type AccountMergeModalProps = {
  visible: boolean;
  summary: MergeSummary | null;
  loading: boolean;
  onChooseCloud: () => void;
  onChooseLocal: () => void;
  onChooseBoth: () => void;
  onClose: () => void;
};

export const AccountMergeModal: React.FC<AccountMergeModalProps> = ({
  visible,
  summary,
  loading,
  onChooseCloud,
  onChooseLocal,
  onChooseBoth,
  onClose,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!visible || !summary) return null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} disabled={loading} />
        <View style={styles.card}>
          <Text style={styles.title}>Choose how to combine your data</Text>
          <Text style={styles.subtitle}>
            Local and account data both exist. Pick which version should become your signed-in view.
          </Text>

          <View style={styles.summary}>
            <Text style={styles.summaryText}>Local notes: {summary.sourceCounts.notes}</Text>
            <Text style={styles.summaryText}>Account notes: {summary.targetCounts.notes}</Text>
            <Text style={styles.summaryText}>
              Local subscriptions: {summary.sourceCounts.subscriptions}
            </Text>
            <Text style={styles.summaryText}>
              Account subscriptions: {summary.targetCounts.subscriptions}
            </Text>
          </View>

          <Pressable
            style={[styles.action, styles.primary]}
            onPress={onChooseCloud}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryText}>Use Account Data</Text>
            )}
          </Pressable>
          <Pressable style={styles.action} onPress={onChooseLocal} disabled={loading}>
            <Text style={styles.secondaryText}>Replace Account With Local</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onChooseBoth} disabled={loading}>
            <Text style={styles.secondaryText}>Keep Both</Text>
          </Pressable>
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
      padding: theme.spacing.lg,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      gap: theme.spacing.md,
    },
    title: {
      fontSize: theme.typography.sizes.xl,
      color: theme.colors.text,
      fontWeight: '700',
    },
    subtitle: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      lineHeight: 20,
    },
    summary: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      padding: theme.spacing.md,
      gap: theme.spacing.xs,
    },
    summaryText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
    },
    action: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      minHeight: 48,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.md,
    },
    primary: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
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
  });
