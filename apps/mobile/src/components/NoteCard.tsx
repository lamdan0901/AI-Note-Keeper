import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type Note } from '../db/notesRepo';
import { type Theme, useTheme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { createHoldInteraction, getTapDecision, HOLD_DELAY_MS } from './noteCardInteractions';
import { formatReminder } from '../utils/formatReminder';
import { hasCustomColor, resolveNoteColor } from '../constants/noteColors';
import { ChecklistDisplay } from './ChecklistDisplay';
import { parseChecklist } from '../../../../packages/shared/utils/checklist';

interface TrashInfo {
  daysRemaining: number;
  onRestore: () => void;
  onDeleteForever: () => void;
  actionPending: boolean;
}

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
  trashInfo?: TrashInfo;
}

const areRenderedNoteFieldsEqual = (left: Note, right: Note): boolean => {
  return (
    left.id === right.id &&
    left.title === right.title &&
    left.content === right.content &&
    left.contentType === right.contentType &&
    left.done === right.done &&
    left.syncStatus === right.syncStatus &&
    left.color === right.color &&
    left.snoozedUntil === right.snoozedUntil &&
    left.nextTriggerAt === right.nextTriggerAt &&
    left.triggerAt === right.triggerAt &&
    left.repeat === right.repeat
  );
};

const areTrashInfoEqual = (left?: TrashInfo, right?: TrashInfo): boolean => {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    left.daysRemaining === right.daysRemaining &&
    left.actionPending === right.actionPending &&
    left.onRestore === right.onRestore &&
    left.onDeleteForever === right.onDeleteForever
  );
};

export const areNoteCardPropsEqual = (
  prevProps: Readonly<NoteCardProps>,
  nextProps: Readonly<NoteCardProps>,
): boolean => {
  return (
    prevProps.variant === nextProps.variant &&
    prevProps.selectionMode === nextProps.selectionMode &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.onPress === nextProps.onPress &&
    prevProps.onLongPress === nextProps.onLongPress &&
    areTrashInfoEqual(prevProps.trashInfo, nextProps.trashInfo) &&
    areRenderedNoteFieldsEqual(prevProps.note, nextProps.note)
  );
};

function NoteCardComponent({
  note,
  variant,
  onPress,
  onLongPress,
  selectionMode = false,
  isSelected = false,
  trashInfo,
}: NoteCardProps) {
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isGrid = variant === 'grid';
  const isDone = !!note.done;
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

  const { backgroundColor, useWhiteText, textColor, mutedTextColor } = useMemo(() => {
    const isDark = resolvedMode === 'dark';
    const resolvedBg = resolveNoteColor(note.color, isDark);
    const hasColor = hasCustomColor(note.color);
    const whiteText = hasColor && isDark;

    return {
      backgroundColor: resolvedBg || theme.colors.surface,
      useWhiteText: whiteText,
      textColor: whiteText ? '#ffffff' : theme.colors.text,
      mutedTextColor: whiteText ? 'rgba(255, 255, 255, 0.8)' : theme.colors.textMuted,
    };
  }, [note.color, resolvedMode, theme.colors.surface, theme.colors.text, theme.colors.textMuted]);

  // Dynamic styles based on variant
  const containerStyle = [
    styles.card,
    isGrid ? styles.cardGrid : styles.cardList,
    isDone && styles.cardDone,
    { backgroundColor },
  ];

  const effectiveTriggerAt = useMemo(
    () => note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt,
    [note.nextTriggerAt, note.snoozedUntil, note.triggerAt],
  );

  const formattedReminder = useMemo(() => {
    if (!effectiveTriggerAt) return null;
    return formatReminder(new Date(effectiveTriggerAt), note.repeat ?? null);
  }, [effectiveTriggerAt, note.repeat]);

  const checklistItems = useMemo(() => {
    if (note.contentType !== 'checklist') return [];
    return parseChecklist(note.content);
  }, [note.content, note.contentType]);

  const title = note.title?.trim();
  const content = note.content?.trim();
  const isChecklist = note.contentType === 'checklist';

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
          <View style={[containerStyle, pressed && styles.pressed, isSelected && styles.selected]}>
            {!!title && (
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  <Text style={[styles.title, isDone && styles.titleDone, { color: textColor }]}>
                    {title}
                  </Text>
                </View>
              </View>
            )}
            {!!content && isChecklist ? (
              <ChecklistDisplay
                items={checklistItems}
                maxItems={isGrid ? 6 : 4}
                theme={theme}
                textColor={textColor}
                mutedTextColor={mutedTextColor}
                isDone={isDone}
              />
            ) : content ? (
              <Text style={[styles.content, isDone && styles.textDone, { color: mutedTextColor }]}>
                {content}
              </Text>
            ) : null}

            {/* Floating Sync Status Icon */}
            {note.syncStatus === 'pending' && (
              <View style={styles.syncStatusFloat}>
                <Ionicons
                  name="cloud-upload-outline"
                  size={14}
                  color={useWhiteText ? mutedTextColor : theme.colors.textMuted}
                />
              </View>
            )}
            {note.syncStatus === 'conflict' && (
              <View style={[styles.syncStatusFloat, styles.conflictFloat]}>
                <Ionicons name="warning-outline" size={14} color={theme.colors.error} />
              </View>
            )}

            {/* Reminder Row */}
            {!trashInfo && !!effectiveTriggerAt && (
              <View style={styles.metaRow}>
                <View style={styles.reminderContainer}>
                  <Ionicons
                    name="alarm-outline"
                    size={14}
                    color={useWhiteText ? mutedTextColor : theme.colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.reminderText,
                      isDone && styles.textDone,
                      { color: mutedTextColor },
                    ]}
                  >
                    {formattedReminder}
                  </Text>
                </View>
              </View>
            )}

            {/* Trash footer */}
            {!!trashInfo && (
              <View style={styles.trashFooter}>
                <Text style={[styles.trashDaysLabel, { color: mutedTextColor }]}>
                  {trashInfo.daysRemaining === 0
                    ? 'Expiring today'
                    : `${trashInfo.daysRemaining}d left`}
                </Text>
                <View style={styles.trashFooterButtons}>
                  <Pressable
                    onPress={trashInfo.onRestore}
                    disabled={trashInfo.actionPending}
                    hitSlop={8}
                  >
                    <Ionicons name="arrow-undo-outline" size={18} color={theme.colors.primary} />
                  </Pressable>
                  <Pressable
                    onPress={trashInfo.onDeleteForever}
                    disabled={trashInfo.actionPending}
                    hitSlop={8}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export const NoteCard = React.memo(NoteCardComponent, areNoteCardPropsEqual);

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
    syncStatusFloat: {
      position: 'absolute',
      top: 4,
      right: 4,
      padding: 2,
      borderRadius: theme.borderRadius.sm,
      backgroundColor: 'rgba(0,0,0,0.06)',
    },
    conflictFloat: {
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
    trashFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: theme.spacing.sm,
    },
    trashDaysLabel: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
    },
    trashFooterButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
    },
  });
