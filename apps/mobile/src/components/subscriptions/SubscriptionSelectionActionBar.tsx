import React, { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../../theme';

export const SUBSCRIPTION_SELECTION_ACTION_BAR_HEIGHT = 80;

type SubscriptionSelectionActionBarProps = {
  selectionHeaderAnim: Animated.Value;
  selectedCount: number;
  onCancel: () => void;
  onDelete: () => void;
};

export const SubscriptionSelectionActionBar: React.FC<SubscriptionSelectionActionBarProps> = ({
  selectionHeaderAnim,
  selectedCount,
  onCancel,
  onDelete,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const selectionMode = selectedCount > 0;

  return (
    <Animated.View
      pointerEvents={selectionMode ? 'auto' : 'none'}
      style={[
        styles.bottomActionBar,
        {
          transform: [
            {
              translateY: selectionHeaderAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [SUBSCRIPTION_SELECTION_ACTION_BAR_HEIGHT, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.bottomActionBarContent}>
        <Pressable style={styles.bottomActionButton} onPress={onCancel}>
          <Ionicons name="close" size={24} color={theme.colors.text} />
          <Text style={styles.bottomActionText}>Cancel</Text>
        </Pressable>
        <Text style={styles.selectedCountText}>{selectedCount} selected</Text>
        <Pressable style={styles.bottomActionButton} onPress={onDelete}>
          <Ionicons name="trash-outline" size={24} color={theme.colors.error} />
          <Text style={styles.bottomActionText}>Delete</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    bottomActionBar: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: SUBSCRIPTION_SELECTION_ACTION_BAR_HEIGHT,
      backgroundColor: theme.colors.surface,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
      paddingHorizontal: theme.spacing.xl,
      elevation: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      justifyContent: 'center',
      zIndex: 1000,
    },
    bottomActionBarContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: '100%',
    },
    bottomActionButton: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      minWidth: 60,
    },
    bottomActionText: {
      fontSize: 10,
      color: theme.colors.text,
      fontWeight: '500',
    },
    selectedCountText: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      fontWeight: '600',
      fontFamily: theme.typography.fontFamily,
    },
  });
