import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform } from 'react-native';
import { type Note } from '../db/notesRepo';
import { RepeatRule } from '../../../../packages/shared/types/reminder';

type EditorTouchStart = { x: number; y: number; timeMs: number } | null;

type UseNoteEditorResult = {
  modalVisible: boolean;
  editingNote: Note | null;
  title: string;
  content: string;
  reminder: Date | null;
  repeat: RepeatRule | null;
  isPinned: boolean;
  color: string | null;
  showReminderModal: boolean;
  editorTranslateY: Animated.Value;
  editorHeightAnim: Animated.Value;
  openEditor: (note?: Note) => void;
  closeEditor: () => void;
  closeEditorFromGesture: () => void;
  handleReminderPress: () => void;
  handleReminderSave: (date: Date, newRepeat: RepeatRule | null) => void;
  setTitle: (value: string) => void;
  setContent: (value: string) => void;
  setReminder: (value: Date | null) => void;
  setRepeat: (value: RepeatRule | null) => void;
  setIsPinned: (value: boolean) => void;
  setColor: (value: string | null) => void;
  setEditingNote: (value: Note | null) => void;
  setShowReminderModal: (value: boolean) => void;
  handleEditorTouchStart: (e: { nativeEvent: { pageX: number; pageY: number } }) => void;
  handleEditorTouchMove: (e: { nativeEvent: { pageX: number; pageY: number } }) => void;
  handleEditorTouchEnd: () => void;
};

export const useNoteEditor = (): UseNoteEditorResult => {
  const [modalVisible, setModalVisible] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [reminder, setReminder] = useState<Date | null>(null);
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [showReminderModal, setShowReminderModal] = useState(false);

  const editorTranslateY = useRef(new Animated.Value(0)).current;
  const editorHeightAnim = useRef(new Animated.Value(0)).current;
  const editorTouchStartRef = useRef<EditorTouchStart>(null);
  const editorDraggingRef = useRef(false);

  const openEditor = useCallback((note?: Note) => {
    if (note) {
      setEditingNote(note);
      setTitle(note.title || '');
      setContent(note.content || '');
      const effectiveTriggerAt = note.snoozedUntil ?? note.nextTriggerAt ?? note.triggerAt;
      if (effectiveTriggerAt) {
        setReminder(new Date(effectiveTriggerAt));
        setRepeat(note.repeat || null);
      } else {
        setReminder(null);
        setRepeat(null);
      }
      setIsPinned(note.isPinned ?? false);
      setColor(note.color || null);
    } else {
      setEditingNote(null);
      setTitle('');
      setContent('');
      setReminder(null);
      setRepeat(null);
      setIsPinned(false);
      setColor(null);
    }
    setModalVisible(true);
  }, []);

  const closeEditor = useCallback(() => {
    setModalVisible(false);
    setEditingNote(null);
    setTitle('');
    setContent('');
    setReminder(null);
    setRepeat(null);
    setIsPinned(false);
    setColor(null);
  }, []);

  const handleReminderPress = useCallback(() => {
    setShowReminderModal(true);
  }, []);

  const handleReminderSave = useCallback((date: Date, newRepeat: RepeatRule | null) => {
    setReminder(date);
    setRepeat(newRepeat);
    setShowReminderModal(false);
  }, []);

  useEffect(() => {
    if (modalVisible) {
      editorTranslateY.setValue(0);
      editorHeightAnim.setValue(0);
    }
  }, [editorTranslateY, editorHeightAnim, modalVisible]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      Animated.timing(editorHeightAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: false,
      }).start();
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      Animated.timing(editorHeightAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [editorHeightAnim]);

  const closeEditorFromGesture = useCallback(() => {
    Animated.timing(editorTranslateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      editorTranslateY.setValue(0);
      closeEditor();
    });
  }, [closeEditor, editorTranslateY]);

  const handleEditorTouchStart = useCallback(
    (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      editorTouchStartRef.current = {
        x: e.nativeEvent.pageX,
        y: e.nativeEvent.pageY,
        timeMs: Date.now(),
      };
      editorDraggingRef.current = false;
    },
    [],
  );

  const handleEditorTouchMove = useCallback(
    (e: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = editorTouchStartRef.current;
      if (!start) return;
      const dx = e.nativeEvent.pageX - start.x;
      const dy = e.nativeEvent.pageY - start.y;
      if (dy <= 0) return;

      if (!editorDraggingRef.current) {
        if (Math.abs(dy) < 12) return;
        if (Math.abs(dy) <= Math.abs(dx)) return;
        editorDraggingRef.current = true;
      }

      editorTranslateY.setValue(dy);
    },
    [editorTranslateY],
  );

  const handleEditorTouchEnd = useCallback(() => {
    const start = editorTouchStartRef.current;
    if (!start) return;
    editorTouchStartRef.current = null;

    if (!editorDraggingRef.current) return;
    editorDraggingRef.current = false;

    editorTranslateY.stopAnimation((value) => {
      const dtMs = Math.max(1, Date.now() - start.timeMs);
      const vy = value / dtMs;
      const shouldClose = value > 140 || vy > 0.9;
      if (shouldClose) {
        closeEditorFromGesture();
        return;
      }
      Animated.spring(editorTranslateY, { toValue: 0, useNativeDriver: true }).start();
    });
  }, [closeEditorFromGesture, editorTranslateY]);

  return {
    modalVisible,
    editingNote,
    title,
    content,
    reminder,
    repeat,
    isPinned,
    color,
    showReminderModal,
    editorTranslateY,
    editorHeightAnim,
    openEditor,
    closeEditor,
    closeEditorFromGesture,
    handleReminderPress,
    handleReminderSave,
    setTitle,
    setContent,
    setReminder,
    setRepeat,
    setIsPinned,
    setColor,
    setEditingNote,
    setShowReminderModal,
    handleEditorTouchStart,
    handleEditorTouchMove,
    handleEditorTouchEnd,
  };
};
