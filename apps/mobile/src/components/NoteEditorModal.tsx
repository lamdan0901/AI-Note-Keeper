import React, { forwardRef, useImperativeHandle, useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ReminderSetupModal } from '../reminders/ui/ReminderSetupModal';
import { type Note } from '../db/notesRepo';
import { formatReminder } from '../utils/formatReminder';
import { type Theme, useTheme } from '../theme';
import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { useNoteEditor } from '../hooks/useNoteEditor';

type NoteEditorModalProps = {
  onSave: (editorState: {
    editingNote: Note | null;
    title: string;
    content: string;
    reminder: Date | null;
    repeat: RepeatRule | null;
    isPinned: boolean;
  }) => void;
  onDelete: () => void;
  onClose?: () => void;
};

export type NoteEditorModalRef = {
  openEditor: (note?: Note) => void;
  closeEditor: () => void;
  getEditorState: () => {
    editingNote: Note | null;
    title: string;
    content: string;
    reminder: Date | null;
    repeat: RepeatRule | null;
    isPinned: boolean;
  };
  setEditingNote: (note: Note | null) => void;
  setReminder: (date: Date | null) => void;
};

export const NoteEditorModal = forwardRef<NoteEditorModalRef, NoteEditorModalProps>(
  function NoteEditorModal({ onSave, onDelete, onClose }, ref) {
    const { theme } = useTheme();
    const styles = useMemo(() => createStyles(theme), [theme]);

    const {
      modalVisible,
      editingNote,
      title,
      content,
      reminder,
      repeat,
      isPinned,
      showReminderModal,
      editorTranslateY,
      openEditor,
      closeEditor,
      handleReminderPress,
      handleReminderSave,
      setTitle,
      setContent,
      setReminder,
      setRepeat,
      setIsPinned,
      setEditingNote,
      setShowReminderModal,
      handleEditorTouchStart,
      handleEditorTouchMove,
      handleEditorTouchEnd,
    } = useNoteEditor();

    useImperativeHandle(ref, () => ({
      openEditor,
      closeEditor,
      getEditorState: () => ({
        editingNote,
        title,
        content,
        reminder,
        repeat,
        isPinned,
      }),
      setEditingNote,
      setReminder,
    }));

    const handleClose = () => {
      closeEditor();
      onClose?.();
    };

    const handleSave = () => {
      onSave({ editingNote, title, content, reminder, repeat, isPinned });
    };

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={handleClose}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={handleClose} />
          <Animated.View
            style={[
              styles.modalContent,
              {
                transform: [{ translateY: editorTranslateY }],
              },
            ]}
            onTouchStart={handleEditorTouchStart}
            onTouchMove={handleEditorTouchMove}
            onTouchEnd={handleEditorTouchEnd}
            onTouchCancel={handleEditorTouchEnd}
          >
            <View style={styles.sheetHandleHitArea}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingNote ? 'Edit Note' : 'New Note'}</Text>

              <View style={styles.headerRight}>
                {reminder && (
                  <Pressable onPress={handleReminderPress}>
                    <View style={styles.headerChip}>
                      <Text style={styles.headerChipText}>{formatReminder(reminder, repeat)}</Text>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          setReminder(null);
                          setRepeat(null);
                        }}
                        hitSlop={8}
                      >
                        <Ionicons name="close-circle" size={16} color={theme.colors.text} />
                      </Pressable>
                    </View>
                  </Pressable>
                )}
                {!reminder && (
                  <Pressable style={styles.iconButton} onPress={handleReminderPress}>
                    <Ionicons name={'alarm-outline'} size={24} color={theme.colors.text} />
                  </Pressable>
                )}
                <Pressable style={styles.iconButton} onPress={() => setIsPinned(!isPinned)}>
                  <Ionicons
                    name={isPinned ? 'push' : 'push-outline'}
                    size={24}
                    color={isPinned ? theme.colors.primary : theme.colors.text}
                  />
                </Pressable>
              </View>
            </View>

            <TextInput
              style={styles.inputTitle}
              placeholder="Title"
              multiline
              value={title}
              onChangeText={setTitle}
              placeholderTextColor={theme.colors.textMuted}
            />
            <TextInput
              style={styles.inputContent}
              placeholder="Description"
              value={content}
              onChangeText={setContent}
              multiline
              textAlignVertical="top"
              placeholderTextColor={theme.colors.textMuted}
            />

            <View style={styles.modalActions}>
              {editingNote && (
                <Pressable style={[styles.button, styles.buttonDelete]} onPress={onDelete}>
                  <Ionicons name="trash-outline" size={20} color={theme.colors.error} />
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              <Pressable style={[styles.button, styles.buttonCancel]} onPress={handleClose}>
                <Text style={styles.buttonTextCancel}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.buttonSave]} onPress={handleSave}>
                <Text style={styles.buttonTextSave}>Save</Text>
              </Pressable>
            </View>

            {showReminderModal && (
              <ReminderSetupModal
                visible={showReminderModal}
                initialDate={reminder}
                initialRepeat={repeat}
                onClose={() => setShowReminderModal(false)}
                onSave={handleReminderSave}
              />
            )}
          </Animated.View>
        </View>
      </Modal>
    );
  },
);

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.borderRadius.xl,
      borderTopRightRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      height: '80%',
      ...theme.shadows.md,
    },
    sheetHandleHitArea: {
      alignSelf: 'stretch',
      alignItems: 'center',
      paddingBottom: theme.spacing.md,
      paddingTop: theme.spacing.xs,
    },
    sheetHandle: {
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: theme.colors.border,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    modalTitle: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    iconButton: {
      padding: theme.spacing.xs,
    },
    inputTitle: {
      fontSize: theme.typography.sizes.xl,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.text,
      marginBottom: theme.spacing.md,
      padding: theme.spacing.sm,
    },
    inputContent: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      flex: 1,
      padding: theme.spacing.sm,
    },
    modalActions: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.md,
      gap: theme.spacing.md,
    },
    button: {
      paddingVertical: theme.spacing.sm,
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.borderRadius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonSave: {
      backgroundColor: theme.colors.primary,
    },
    buttonCancel: {
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    buttonDelete: {
      backgroundColor: '#fee2e2',
      paddingHorizontal: theme.spacing.md,
    },
    buttonTextSave: {
      color: 'white',
      fontWeight: '600',
    },
    buttonTextCancel: {
      color: theme.colors.text,
      fontWeight: '600',
    },
    headerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.border,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.sm,
      gap: 4,
    },
    headerChipText: {
      fontSize: 12,
      color: theme.colors.text,
      fontWeight: '500',
    },
  });
