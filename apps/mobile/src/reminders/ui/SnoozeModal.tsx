import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { type Theme, useTheme } from '../../theme';
import { buildReminderPresetOptions } from './ReminderPresetDropdown';

interface RescheduleModalProps {
  visible: boolean;
  onClose: () => void;
  noteId: string;
  onRescheduled?: (noteId: string, snoozedUntil: number) => void;
  transparentOverlay?: boolean;
  onSaveStart?: () => void;
  onError?: (error: unknown) => void;
}

export const RescheduleModal = ({
  visible,
  onClose,
  noteId,
  onRescheduled,
  transparentOverlay = false,
  onSaveStart,
  onError,
}: RescheduleModalProps) => {
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [customDate, setCustomDate] = useState(new Date());
  const [now, setNow] = useState<Date>(new Date());
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [translateY, visible]);

  useEffect(() => {
    if (!visible) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, [visible]);

  const closeFromGesture = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 600,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      onClose();
    });
  }, [onClose, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        if (gestureState.dy <= 0) return false;
        if (Math.abs(gestureState.dy) < 8) return false;
        return Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dy > 0) translateY.setValue(gestureState.dy);
      },
      onPanResponderRelease: (_evt, gestureState) => {
        const shouldClose = gestureState.dy > 120 || gestureState.vy > 0.75;
        if (shouldClose) {
          closeFromGesture();
          return;
        }
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const handleReschedule = async (rescheduleTime: Date) => {
    try {
      if (rescheduleTime.getTime() <= Date.now()) {
        Alert.alert('Invalid Time', 'Reschedule time must be in the future.');
        return;
      }

      onSaveStart?.();
      const timestamp = rescheduleTime.getTime();

      // Delegate persistence to callback
      if (onRescheduled) {
        onRescheduled(noteId, timestamp);
      }

      onClose();
    } catch (e) {
      console.error('Reschedule failed:', e);
      if (onError) {
        onError(e);
      } else {
        Alert.alert('Error', 'Failed to reschedule reminder');
      }
    }
  };

  const onDateChange = (event: { type: string }, selectedDate?: Date) => {
    const currentDate = selectedDate || customDate;

    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (datePickerMode === 'date' && event.type !== 'dismissed') {
        setCustomDate(currentDate);
        setDatePickerMode('time');
        setTimeout(() => setShowDatePicker(true), 100);
      } else if (datePickerMode === 'time' && event.type !== 'dismissed') {
        // Commit
        handleReschedule(currentDate);
      }
    } else {
      if (event.type !== 'dismissed') {
        setCustomDate(currentDate);
        handleReschedule(currentDate);
      }
    }
  };

  const presetGroups = useMemo(() => buildReminderPresetOptions(now), [now]);

  return (
    <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={onClose}>
      <Pressable
        style={[styles.modalOverlay, transparentOverlay && { backgroundColor: 'transparent' }]}
        onPress={onClose}
      >
        <Pressable style={styles.modalContentPressable} onPress={() => {}}>
          <Animated.View style={[styles.modalContent, { transform: [{ translateY }] }]}>
            <View style={styles.sheetHandleHitArea} {...panResponder.panHandlers}>
              <View style={styles.sheetHandle} />
            </View>
            <View style={styles.header}>
              <Text style={styles.title}>Reschedule to...</Text>
              <Pressable onPress={onClose}>
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </Pressable>
            </View>

            {presetGroups.today.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Today</Text>
                {presetGroups.today.map((opt) => (
                  <Pressable
                    key={opt.id}
                    style={styles.option}
                    onPress={() => handleReschedule(opt.date)}
                  >
                    <Ionicons name="time-outline" size={20} color={theme.colors.text} />
                    <Text style={styles.optionText}>
                      {opt.title} ({opt.timeLabel})
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            <Text style={styles.groupLabel}>Tomorrow</Text>
            {presetGroups.tomorrow.map((opt) => (
              <Pressable
                key={opt.id}
                style={styles.option}
                onPress={() => handleReschedule(opt.date)}
              >
                <Ionicons name="time-outline" size={20} color={theme.colors.text} />
                <Text style={styles.optionText}>
                  {opt.title} ({opt.timeLabel})
                </Text>
              </Pressable>
            ))}

            <Pressable
              style={styles.option}
              onPress={() => {
                setCustomDate(new Date());
                setDatePickerMode('date');
                setShowDatePicker(true);
              }}
            >
              <Ionicons name="calendar-outline" size={20} color={theme.colors.text} />
              <Text style={styles.optionText}>Pick a date & time</Text>
            </Pressable>

            {showDatePicker && (
              <DateTimePicker
                value={customDate}
                mode={datePickerMode}
                is24Hour={false}
                themeVariant={resolvedMode}
                onChange={onDateChange}
              />
            )}
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'flex-end',
    },
    modalContentPressable: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: theme.borderRadius.xl,
      borderTopRightRadius: theme.borderRadius.xl,
      padding: theme.spacing.lg,
      paddingBottom: theme.spacing.xl,
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
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.md,
    },
    title: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    groupLabel: {
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: theme.spacing.sm,
      marginBottom: theme.spacing.xs,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.spacing.md,
      gap: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    optionText: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
    },
  });
