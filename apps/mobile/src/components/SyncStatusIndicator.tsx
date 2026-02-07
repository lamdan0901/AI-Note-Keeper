import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncState } from '../sync/syncManager';
import { theme } from '../theme';

export const SyncStatusIndicator: React.FC = () => {
  const { isOnline, isSyncing, hasConflicts } = useSyncState();

  if (hasConflicts) {
    return (
      <View style={styles.container}>
        <Ionicons name="warning" size={18} color={theme.colors.error} />
        <Text style={[styles.text, styles.conflictText]}>Conflicts</Text>
      </View>
    );
  }

  if (isSyncing) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={styles.text}>Syncing</Text>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={styles.container}>
        <Ionicons name="cloud-offline" size={18} color={theme.colors.textMuted} />
        <Text style={[styles.text, styles.offlineText]}>Offline</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: theme.colors.surface,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
    color: theme.colors.text,
  },
  offlineText: {
    color: theme.colors.textMuted,
  },
  conflictText: {
    color: theme.colors.error,
  },
});
