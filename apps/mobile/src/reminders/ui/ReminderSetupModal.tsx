import React, { useMemo, useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Platform, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { type Theme, useTheme } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { RepeatRule } from '../../../../../packages/shared/types/reminder';
import { RecurrencePicker } from './RecurrencePicker';
import { ReminderPresetDropdown } from './ReminderPresetDropdown';

interface ReminderSetupModalProps {
  visible: boolean;
  initialDate?: Date | null;
  initialRepeat?: RepeatRule | null;
  onClose: () => void;
  onSave: (date: Date, repeat: RepeatRule | null) => void;
}

export const ReminderSetupModal: React.FC<ReminderSetupModalProps> = ({
  visible,
  initialDate,
  initialRepeat,
  onClose,
  onSave,
}) => {
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [triggerDate, setTriggerDate] = useState<Date>(new Date());
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  // Picker state for Android
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  useEffect(() => {
    if (visible) {
      const nowTime = new Date();
      setNow(nowTime);

      let start = initialDate || new Date();

      // If the date is in the past (either new or editing an old reminder), auto-update it
      if (start.getTime() < nowTime.getTime()) {
        const nextHour = new Date(nowTime);

        // If it's 10:00 PM (22:00) or later, default to tomorrow at 7:00 AM
        if (nowTime.getHours() >= 22) {
          nextHour.setDate(nextHour.getDate() + 1);
          nextHour.setHours(7, 0, 0, 0);
        } else {
          // Otherwise, default to the next hour today
          nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        }
        start = nextHour;
      }

      setTriggerDate(start);
      setRepeat(initialRepeat || null);
    }
  }, [visible, initialDate, initialRepeat]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, [visible]);

  const handleDateChange = (event: { type: string }, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'dismissed') return;

      const currentDate = selectedDate || triggerDate;

      if (pickerMode === 'date') {
        const newDate = new Date(triggerDate);
        newDate.setFullYear(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          currentDate.getDate(),
        );
        newDate.setSeconds(0, 0);
        setTriggerDate(newDate);

        // Auto-open time picker
        setPickerMode('time');
        setTimeout(() => setShowPicker(true), 100);
      } else {
        const newDate = new Date(triggerDate);
        newDate.setHours(currentDate.getHours(), currentDate.getMinutes(), 0, 0);
        setTriggerDate(newDate);
      }
    } else {
      // iOS
      if (selectedDate) {
        const newDate = new Date(selectedDate);
        newDate.setSeconds(0, 0);
        setTriggerDate(newDate);
      }
    }
  };

  const handleSave = () => {
    const normalizedDate = new Date(triggerDate);
    normalizedDate.setSeconds(0, 0);
    if (normalizedDate.getTime() <= Date.now()) {
      Alert.alert('Invalid Time', 'Please select a time in the future.');
      return;
    }
    onSave(normalizedDate, repeat);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.container} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Set Reminder</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          <View style={styles.content}>
            {/* Date/Time Selection */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Time</Text>

              <ReminderPresetDropdown
                now={now}
                value={triggerDate}
                onSelect={(date) => setTriggerDate(date)}
                onInvalidSelection={(message) => Alert.alert('Invalid Time', message)}
              />

              <View style={{ height: theme.spacing.sm }} />

              {Platform.OS === 'ios' ? (
                <View style={styles.iosPickerContainer}>
                  <DateTimePicker
                    value={triggerDate}
                    mode="datetime"
                    display="spinner" // or compact
                    themeVariant={resolvedMode}
                    onChange={handleDateChange}
                    minimumDate={new Date()}
                    style={{ height: 120 }} // Constrain height
                  />
                </View>
              ) : (
                <View style={styles.androidRow}>
                  <Pressable
                    style={styles.dateButton}
                    onPress={() => {
                      setPickerMode('date');
                      setShowPicker(true);
                    }}
                  >
                    <Ionicons name="calendar-outline" size={20} color={theme.colors.primary} />
                    <Text style={styles.dateButtonText}>{formatDate(triggerDate)}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.dateButton}
                    onPress={() => {
                      setPickerMode('time');
                      setShowPicker(true);
                    }}
                  >
                    <Ionicons name="time-outline" size={20} color={theme.colors.primary} />
                    <Text style={styles.dateButtonText}>{formatTime(triggerDate)}</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <View style={styles.separator} />

            {/* Recurrence */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Repeat</Text>
              <RecurrencePicker repeat={repeat} onChange={setRepeat} />
            </View>
          </View>

          <View style={styles.footer}>
            <Pressable style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.saveButton} onPress={handleSave}>
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      {/* Android Native Picker */}
      {Platform.OS === 'android' && showPicker && (
        <DateTimePicker
          value={triggerDate}
          mode={pickerMode}
          is24Hour={false}
          display="default"
          themeVariant={resolvedMode}
          onChange={handleDateChange}
          minimumDate={new Date()}
        />
      )}
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: theme.spacing.md,
    },
    container: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      ...theme.shadows.md,
      maxHeight: '90%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    title: {
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.bold as '700',
      color: theme.colors.text,
    },
    content: {
      padding: theme.spacing.md,
    },
    section: {
      marginBottom: theme.spacing.md,
    },
    sectionTitle: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontWeight: '600',
      marginBottom: theme.spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    separator: {
      height: 1,
      backgroundColor: theme.colors.border,
      marginBottom: theme.spacing.md,
    },
    androidRow: {
      flexDirection: 'row',
      gap: theme.spacing.md,
    },
    dateButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: theme.spacing.sm,
      backgroundColor: theme.colors.background,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    dateButtonText: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
    },
    iosPickerContainer: {
      alignItems: 'center',
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      padding: theme.spacing.md,
      gap: theme.spacing.md,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    cancelButton: {
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: theme.borderRadius.md,
    },
    cancelButtonText: {
      color: theme.colors.textMuted,
      fontWeight: '600',
    },
    saveButton: {
      backgroundColor: theme.colors.primary,
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: theme.borderRadius.md,
    },
    saveButtonText: {
      color: 'white',
      fontWeight: '600',
    },
  });
