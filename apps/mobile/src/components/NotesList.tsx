import React, { useMemo } from 'react';
import { FlatList, StyleSheet, View, Text } from 'react-native';
import { type Note } from '../db/notesRepo';
import { NoteCard } from './NoteCard';
import { type Theme, useTheme } from '../theme';

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
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isGrid = viewMode === 'grid';
  const showActionButtons = selectedNoteIds.size < 2;

  const { pinnedNotes, otherNotes } = useMemo(() => {
    const pinned: Note[] = [];
    const others: Note[] = [];
    notes.forEach((note) => {
      if (note.isPinned) {
        pinned.push(note);
      } else {
        others.push(note);
      }
    });
    return { pinnedNotes: pinned, otherNotes: others };
  }, [notes]);

  // Distribute notes into two columns for masonry layout (Google Keep style)
  const { leftColumn, rightColumn } = useMemo(() => {
    const left: Note[] = [];
    const right: Note[] = [];

    // Simple distribution: alternate notes between columns
    // For better distribution, we'd need to measure heights, but this works well enough
    otherNotes.forEach((note, index) => {
      if (index % 2 === 0) {
        left.push(note);
      } else {
        right.push(note);
      }
    });

    return { leftColumn: left, rightColumn: right };
  }, [otherNotes]);

  const { pinnedLeft, pinnedRight } = useMemo(() => {
    const left: Note[] = [];
    const right: Note[] = [];

    pinnedNotes.forEach((note, index) => {
      if (index % 2 === 0) {
        left.push(note);
      } else {
        right.push(note);
      }
    });

    return { pinnedLeft: left, pinnedRight: right };
  }, [pinnedNotes]);

  const renderNote = (item: Note) => (
    <NoteCard
      key={item.id}
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
  );

  const renderPinnedSection = () => {
    if (pinnedNotes.length === 0) return null;

    if (isGrid) {
      return (
        <View>
          <Text style={styles.sectionHeader}>Pinned</Text>
          <View style={styles.masonryContainer}>
            <View style={styles.masonryColumn}>{pinnedLeft.map(renderNote)}</View>
            <View style={styles.masonryColumn}>{pinnedRight.map(renderNote)}</View>
          </View>
          <Text style={styles.sectionHeader}>Others</Text>
        </View>
      );
    }

    return (
      <View>
        <Text style={styles.sectionHeader}>Pinned</Text>
        <View style={styles.listContainer}>{pinnedNotes.map(renderNote)}</View>
        <Text style={styles.sectionHeader}>Others</Text>
      </View>
    );
  };

  if (notes.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No notes yet. Create one!</Text>
      </View>
    );
  }

  // Masonry layout for grid view
  if (isGrid) {
    return (
      <FlatList
        key={viewMode}
        data={[{ key: 'masonry' }]}
        renderItem={() => (
          <View style={styles.masonryContainer}>
            <View style={styles.masonryColumn}>{leftColumn.map(renderNote)}</View>
            <View style={styles.masonryColumn}>{rightColumn.map(renderNote)}</View>
          </View>
        )}
        ListHeaderComponent={renderPinnedSection}
        contentContainerStyle={styles.listContent}
        onRefresh={onRefresh}
        refreshing={refreshing}
      />
    );
  }

  // List view remains unchanged
  return (
    <FlatList
      key={viewMode}
      data={otherNotes}
      ListHeaderComponent={renderPinnedSection}
      renderItem={({ item }) => renderNote(item)}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      onRefresh={onRefresh}
      refreshing={refreshing}
    />
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    listContent: {
      padding: theme.spacing.sm,
      gap: theme.spacing.sm,
      paddingBottom: 100,
    },
    sectionHeader: {
      fontSize: theme.typography.sizes.xs,
      fontWeight: '600',
      color: theme.colors.textMuted,
      marginBottom: theme.spacing.sm,
      marginLeft: 4,
      textTransform: 'uppercase',
    },
    masonryContainer: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
    },
    masonryColumn: {
      flex: 1,
      gap: theme.spacing.sm,
    },
    listContainer: {
      gap: theme.spacing.sm,
      marginBottom: theme.spacing.lg,
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
