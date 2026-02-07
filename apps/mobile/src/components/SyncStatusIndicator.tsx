import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSyncState } from '../sync/syncManager';
import { theme } from '../theme';

export const SyncStatusIndicator: React.FC = () => {
  const { isOnline, isSyncing, hasConflicts, actionResult, clearActionResult } = useSyncState();

  // 1. Error State (Highest Priority)
  if (actionResult?.status === 'error') {
    return (
      <Pressable onPress={clearActionResult} style={[styles.container, styles.errorContainer]}>
        <Ionicons name="close-circle" size={18} color={theme.colors.error} />
        <Text style={[styles.text, styles.errorText]}>{actionResult.message || 'Sync Failed'}</Text>
      </Pressable>
    );
  }

  // 2. Success State
  if (actionResult?.status === 'success') {
    return (
      <View style={[styles.container, styles.successContainer]}>
        <Ionicons name="checkmark-circle" size={18} color={theme.colors.success} />
        <Text style={[styles.text, styles.successText]}>Saved</Text>
      </View>
    );
  }

  // 3. Conflict State
  if (hasConflicts) {
    return (
      <View style={styles.container}>
        <Ionicons name="warning" size={18} color={theme.colors.error} />
        <Text style={[styles.text, styles.conflictText]}>Conflicts</Text>
      </View>
    );
  }

  // 4. Syncing/Pending State
  if (isSyncing || actionResult?.status === 'pending') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="small" color={theme.colors.primary} />
        <Text style={styles.text}>Syncing</Text>
      </View>
    );
  }

  // 5. Offline State
  if (!isOnline) {
    return (
      <View style={styles.container}>
        <Ionicons name="cloud-offline" size={18} color={theme.colors.textMuted} />
        <Text style={[styles.text, styles.offlineText]}>Offline</Text>
      </View>
    );
  }

  // 6. Idle/Online State
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
  errorContainer: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  errorText: {
    color: theme.colors.error,
  },
  successContainer: {
    backgroundColor: theme.colors.surface,
  },
  successText: {
    color: theme.colors.success,
  },
});
