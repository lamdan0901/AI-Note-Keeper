import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Note } from '../db/notesRepo';
import { theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { createHoldInteraction, getTapDecision, HOLD_DELAY_MS } from './noteCardInteractions';

const CORNER_BUTTON_SIZE = 24;
const CORNER_BUTTON_OFFSET = CORNER_BUTTON_SIZE / 2;
const SELECTION_ANIMATION_DURATION_MS = 240;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  showActionButtons = true,
  onDonePress,
  onReschedulePress,
  onDeletePress,
}) => {
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

  // Use note color if available, otherwise surface white
  const backgroundColor = note.color ?? theme.colors.surface;

  // Dynamic styles based on variant
  const containerStyle = [
    styles.card,
    isGrid ? styles.cardGrid : styles.cardList,
    isDone && styles.cardDone,
    { backgroundColor },
  ];

  const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;

  const formatReminder = (timestamp: number, repeat: RepeatRule | null | undefined) => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    if (repeat) {
      return `${timeStr} 🔁`;
    }
    return timeStr;
  };

  const selectionCardStyle = useMemo(() => {
    const scale = selectionAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.94],
    });
    return { transform: [{ scale }] };
  }, [selectionAnim]);

  const title = note.title?.trim();
  const content = note.content?.trim();

  const cornerButtonOpacity = isSelected ? selectionAnim : 0;

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
                  <Text
                    style={[styles.title, isDone && styles.titleDone]}
                    numberOfLines={isGrid ? 2 : 1}
                  >
                    {title}
                  </Text>
                </View>
              </View>
            )}
            {!!content && (
              <Text
                style={[styles.content, isDone && styles.textDone]}
                numberOfLines={isGrid ? 5 : 2}
              >
                {content}
              </Text>
            )}

            {effectiveTriggerAt && (
              <View style={styles.reminderContainer}>
                <Ionicons name="alarm-outline" size={14} color={theme.colors.textMuted} />
                <Text style={[styles.reminderText, isDone && styles.textDone]}>
                  {formatReminder(effectiveTriggerAt, note.repeat)}
                </Text>
              </View>
            )}
          </Animated.View>
        )}
      </Pressable>

      {showActionButtons && isSelected && onDonePress && (
        <AnimatedPressable
          style={[
            styles.cornerButton,
            styles.cornerTopLeft,
            isDone ? styles.cornerDone : styles.cornerNotDone,
            { opacity: cornerButtonOpacity },
          ]}
          hitSlop={10}
          pointerEvents={isSelected ? 'auto' : 'none'}
          disabled={!isSelected}
          onPress={() => onDonePress(note.id)}
        >
          <Ionicons
            name={isDone ? 'checkmark' : 'checkmark'}
            size={16}
            color={isDone ? theme.colors.surface : theme.colors.primary}
          />
        </AnimatedPressable>
      )}

      {showActionButtons && isSelected && onReschedulePress && (
        <AnimatedPressable
          style={[styles.cornerButton, styles.cornerTopRight, { opacity: cornerButtonOpacity }]}
          hitSlop={10}
          pointerEvents={isSelected ? 'auto' : 'none'}
          disabled={!isSelected}
          onPress={() => onReschedulePress(note.id)}
        >
          <Ionicons name="time-outline" size={16} color={theme.colors.textMuted} />
        </AnimatedPressable>
      )}

      {showActionButtons && isSelected && onDeletePress && (
        <AnimatedPressable
          style={[styles.cornerButton, styles.cornerBottomLeft, { opacity: cornerButtonOpacity }]}
          hitSlop={10}
          pointerEvents={isSelected ? 'auto' : 'none'}
          disabled={!isSelected}
          onPress={() => onDeletePress(note.id)}
        >
          <Ionicons name="trash-outline" size={16} color={theme.colors.error} />
        </AnimatedPressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
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
    minHeight: 150, // Taller cards for grid
  },
  wrapperList: {
    marginBottom: theme.spacing.sm,
  },
  wrapperGrid: {
    flex: 1,
    margin: theme.spacing.xs,
  },
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
  reminderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: theme.spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    alignSelf: 'flex-start',
    gap: 4,
  },
  reminderText: {
    fontSize: 11,
    color: theme.colors.textMuted,
    fontWeight: '500',
  },
  cornerButton: {
    position: 'absolute',
    width: CORNER_BUTTON_SIZE,
    height: CORNER_BUTTON_SIZE,
    borderRadius: CORNER_BUTTON_SIZE / 2,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.sm,
  },
  cornerTopLeft: {
    top: -CORNER_BUTTON_OFFSET,
    left: -CORNER_BUTTON_OFFSET,
  },
  cornerDone: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  cornerNotDone: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.primary,
  },
  cornerTopRight: {
    top: -CORNER_BUTTON_OFFSET,
    right: -CORNER_BUTTON_OFFSET,
  },
  cornerBottomLeft: {
    bottom: -CORNER_BUTTON_OFFSET,
    left: -CORNER_BUTTON_OFFSET,
  },
});
