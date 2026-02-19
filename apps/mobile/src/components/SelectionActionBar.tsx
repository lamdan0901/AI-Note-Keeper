import React, { useMemo } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Theme, useTheme } from '../theme';

export const BOTTOM_ACTION_BAR_HEIGHT = 80;

type SelectionActionBarProps = {
  selectionHeaderAnim: Animated.Value;
  selectedCount: number;
  onCancel: () => void;
  onMarkDone: () => void;
  onSnooze: () => void;
  onDelete: () => void;
};

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectionHeaderAnim,
  selectedCount,
  onCancel,
  onMarkDone,
  onSnooze,
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
                outputRange: [BOTTOM_ACTION_BAR_HEIGHT, 0],
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
        <View style={styles.bottomActionSpacer} />
        <Pressable style={styles.bottomActionButton} onPress={onMarkDone}>
          <Ionicons name="checkmark-circle-outline" size={24} color={theme.colors.primary} />
          <Text style={styles.bottomActionText}>Done</Text>
        </Pressable>
        {selectedCount === 1 && (
          <Pressable style={styles.bottomActionButton} onPress={onSnooze}>
            <Ionicons name="time-outline" size={24} color={theme.colors.text} />
            <Text style={styles.bottomActionText}>Snooze</Text>
          </Pressable>
        )}
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
      height: BOTTOM_ACTION_BAR_HEIGHT,
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
    bottomActionSpacer: {
      flex: 1,
    },
  });
