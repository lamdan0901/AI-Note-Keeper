import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { type Theme, useTheme } from '../theme';

type NotesHeaderProps = {
  viewMode: 'list' | 'grid';
  selectionMode: boolean;
  onViewModeToggle: () => void;
  onMenuPress: () => void;
};

export const NotesHeader: React.FC<NotesHeaderProps> = ({
  viewMode,
  selectionMode,
  onViewModeToggle,
  onMenuPress,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={[styles.header, selectionMode && styles.headerHidden]}>
      <View style={styles.headerLeft}>
        <Pressable style={styles.iconButton} onPress={onMenuPress}>
          <Ionicons name="menu" size={26} color={theme.colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>My Notes</Text>
      </View>
      <View style={styles.headerRight}>
        <SyncStatusIndicator />
        <Pressable style={styles.iconButton} onPress={onViewModeToggle}>
          <Ionicons
            name={viewMode === 'grid' ? 'list' : 'grid'}
            size={24}
            color={theme.colors.primary}
          />
        </Pressable>
      </View>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    header: {
      padding: theme.spacing.md,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    headerTitle: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
      fontFamily: theme.typography.fontFamily,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iconButton: {
      padding: theme.spacing.xs,
    },
    headerHidden: {
      opacity: 0,
    },
  });
