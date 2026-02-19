import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Note } from '../db/notesRepo';
import { darkTheme, lightTheme, type Theme, useTheme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { createHoldInteraction, getTapDecision, HOLD_DELAY_MS } from './noteCardInteractions';
import { formatReminder } from '../utils/formatReminder';

const SELECTION_ANIMATION_DURATION_MS = 240;

interface NoteCardProps {
  note: Note;
  variant: 'list' | 'grid';
  onPress: (noteId: string) => void;
  onLongPress?: (noteId: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  showActionButtons?: boolean;
  onDonePress?: (noteId: string) => void;
  onReschedulePress?: (noteId: string) => void;
  onDeletePress?: (noteId: string) => void;
}

export const NoteCard: React.FC<NoteCardProps> = ({
  note,
  variant,
  onPress,
  onLongPress,
  selectionMode = false,
  isSelected = false,
}) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isGrid = variant === 'grid';
  const isDone = !!note.done;

  const selectionAnim = useRef(new Animated.Value(isSelected ? 1 : 0)).current;
  const holdHandlerRef = useRef<(() => void) | null>(null);
  const holdInteractionRef = useRef<ReturnType<typeof createHoldInteraction> | null>(null);

  holdHandlerRef.current = () => {
    onLongPress?.(note.id);
  };

  if (!holdInteractionRef.current) {
    holdInteractionRef.current = createHoldInteraction({
      delayMs: HOLD_DELAY_MS,
      onHold: () => holdHandlerRef.current?.(),
    });
  }

  useEffect(() => {
    return () => {
      holdInteractionRef.current?.end();
    };
  }, []);

  useEffect(() => {
    Animated.timing(selectionAnim, {
      toValue: isSelected ? 1 : 0,
      duration: SELECTION_ANIMATION_DURATION_MS,
      useNativeDriver: true,
    }).start();
  }, [isSelected, selectionAnim]);

  const isDefaultColor =
    note.color === lightTheme.colors.surface || note.color === darkTheme.colors.surface;
  const backgroundColor = note.color && !isDefaultColor ? note.color : theme.colors.surface;

  // Dynamic styles based on variant
  const containerStyle = [
    styles.card,
    isGrid ? styles.cardGrid : styles.cardList,
    isDone && styles.cardDone,
    { backgroundColor },
  ];

  const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;

  const selectionCardStyle = useMemo(() => {
    const scale = selectionAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.94],
    });
    return { transform: [{ scale }] };
  }, [selectionAnim]);

  const title = note.title?.trim();
  const content = note.content?.trim();

  return (
    <View style={[styles.wrapper, isGrid ? styles.wrapperGrid : styles.wrapperList]}>
      <Pressable
        onPressIn={() => holdInteractionRef.current?.start()}
        onPressOut={() => holdInteractionRef.current?.end()}
        onPress={() => {
          if (holdInteractionRef.current?.consumeHoldFired()) return;
          const decision = getTapDecision({ selectionModeActive: selectionMode });
          if (decision === 'toggleSelection') {
            onLongPress?.(note.id);
            return;
          }
          onPress(note.id);
        }}
      >
        {({ pressed }) => (
          <Animated.View
            style={[
              containerStyle,
              selectionCardStyle,
              pressed && styles.pressed,
              isSelected && styles.selected,
            ]}
          >
            {!!title && (
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={[styles.title, isDone && styles.titleDone]}>{title}</Text>
                </View>
              </View>
            )}
            {!!content && (
              <Text style={[styles.content, isDone && styles.textDone]}>{content}</Text>
            )}

            {/* Sync Status & Reminder Row */}
            <View style={styles.metaRow}>
              {/* Sync Status Icon */}
              {note.syncStatus === 'pending' && (
                <View style={styles.syncStatusBadge}>
                  <Ionicons name="cloud-upload-outline" size={14} color={theme.colors.textMuted} />
                </View>
              )}
              {note.syncStatus === 'conflict' && (
                <View style={[styles.syncStatusBadge, styles.conflictBadge]}>
                  <Ionicons name="warning-outline" size={14} color={theme.colors.error} />
                </View>
              )}

              {/* Reminder Badge */}
              {effectiveTriggerAt && (
                <View style={styles.reminderContainer}>
                  <Ionicons name="alarm-outline" size={14} color={theme.colors.textMuted} />
                  <Text style={[styles.reminderText, isDone && styles.textDone]}>
                    {formatReminder(new Date(effectiveTriggerAt), note.repeat ?? null)}
                  </Text>
                </View>
              )}
            </View>
          </Animated.View>
        )}
      </Pressable>
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    wrapper: {
      position: 'relative',
    },
    card: {
      padding: theme.spacing.md,
      borderRadius: theme.borderRadius.md,
      ...theme.shadows.sm,
      borderColor: theme.colors.border,
      borderWidth: 1,
    },
    cardList: {
      width: '100%',
    },
    cardGrid: {
      flex: 1,
    },
    wrapperList: {
      marginBottom: theme.spacing.sm,
    },
    wrapperGrid: {},
    cardDone: {
      opacity: 0.7,
    },
    pressed: {
      opacity: 0.92,
    },
    selected: {
      opacity: 0.98,
      borderColor: theme.colors.primary,
      borderWidth: 2,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: theme.spacing.xs,
    },
    headerLeft: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      flex: 1,
    },
    title: {
      fontSize: theme.typography.sizes.base,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.text,
      flex: 1,
    },
    titleDone: {
      textDecorationLine: 'line-through',
    },
    content: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      lineHeight: 20,
    },
    textDone: {
      color: theme.colors.textMuted,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.sm,
      gap: 8,
      flexWrap: 'wrap',
    },
    syncStatusBadge: {
      padding: 4,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: 'rgba(0,0,0,0.05)',
    },
    conflictBadge: {
      backgroundColor: 'rgba(239,68,68,0.1)',
    },
    reminderContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.sm,
      gap: 4,
    },
    reminderText: {
      fontSize: 11,
      color: theme.colors.textMuted,
      fontWeight: '500',
    },
  });
