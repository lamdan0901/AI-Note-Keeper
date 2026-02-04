import React from 'react';
import { FlatList, StyleSheet, View, Text } from 'react-native';
import { type Note } from '../db/notesRepo';
import { NoteCard } from './NoteCard';
import { theme } from '../theme';

interface NotesListProps {
  notes: Note[];
  viewMode: 'list' | 'grid';
  onNotePress: (noteId: string) => void;
  onNoteLongPress: (noteId: string) => void;
  selectionMode: boolean;
  selectedNoteIds: Set<string>;
  onNoteDone?: (noteId: string) => void;
  onNoteReschedule?: (noteId: string) => void;
  onNoteDelete?: (noteId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export const NotesList: React.FC<NotesListProps> = ({
  notes,
  viewMode,
  onNotePress,
  onNoteLongPress,
  selectionMode,
  selectedNoteIds,
  onNoteDone,
  onNoteReschedule,
  onNoteDelete,
  onRefresh,
  refreshing,
}) => {
  const isGrid = viewMode === 'grid';
  const showActionButtons = selectedNoteIds.size < 2;

  if (notes.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No notes yet. Create one!</Text>
      </View>
    );
  }

  return (
    <FlatList
      key={viewMode} // Force full re-render when switching modes to update numColumns
      data={notes}
      renderItem={({ item }) => (
        <NoteCard
          note={item}
          variant={viewMode}
          onPress={onNotePress}
          onLongPress={onNoteLongPress}
          selectionMode={selectionMode}
          isSelected={selectedNoteIds.has(item.id)}
          showActionButtons={showActionButtons}
          onDonePress={onNoteDone}
          onReschedulePress={onNoteReschedule}
          onDeletePress={onNoteDelete}
        />
      )}
      keyExtractor={(item) => item.id}
      numColumns={isGrid ? 2 : 1}
      contentContainerStyle={styles.listContent}
      onRefresh={onRefresh}
      refreshing={refreshing}
      columnWrapperStyle={isGrid ? styles.columnWrapper : undefined}
    />
  );
};

const styles = StyleSheet.create({
  listContent: {
    padding: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  columnWrapper: {
    justifyContent: 'space-between',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.xl,
  },
  emptyText: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.textMuted,
    fontFamily: theme.typography.fontFamily,
  },
});
