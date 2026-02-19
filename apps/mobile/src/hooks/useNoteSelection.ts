import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';
import { type Note } from '../db/notesRepo';

type UseNoteSelectionResult = {
  selectedNoteIds: Set<string>;
  selectionMode: boolean;
  selectionHeaderAnim: Animated.Value;
  clearSelection: () => void;
  handleNoteLongPress: (noteId: string) => void;
};

export const useNoteSelection = (notes: Note[]): UseNoteSelectionResult => {
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const selectionHeaderAnim = useRef(new Animated.Value(0)).current;
  const selectionMode = selectedNoteIds.size > 0;

  useEffect(() => {
    Animated.timing(selectionHeaderAnim, {
      toValue: selectionMode ? 1 : 0,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [selectionHeaderAnim, selectionMode]);

  useEffect(() => {
    if (selectedNoteIds.size === 0) return;
    const currentIds = new Set(notes.map((note) => note.id));
    setSelectedNoteIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (currentIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [notes, selectedNoteIds.size]);

  const clearSelection = useCallback(() => {
    setSelectedNoteIds(new Set());
  }, []);

  const handleNoteLongPress = useCallback((noteId: string) => {
    setSelectedNoteIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  return {
    selectedNoteIds,
    selectionMode,
    selectionHeaderAnim,
    clearSelection,
    handleNoteLongPress,
  };
};
