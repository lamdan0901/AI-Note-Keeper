import React, { useMemo, useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { type Theme, useTheme } from '../../theme';
import { Ionicons } from '@expo/vector-icons';
import { RepeatRule } from '../../../../../packages/shared/types/reminder';
import { RecurrencePicker } from './RecurrencePicker';
import { ReminderPresetDropdown } from './ReminderPresetDropdown';

const TIME_PRESETS = [
  { label: '6:30 AM', hours: 6, minutes: 30 },
  { label: '9:00 AM', hours: 9, minutes: 0 },
  { label: '11:30 AM', hours: 11, minutes: 30 },
  { label: '3:00 PM', hours: 15, minutes: 0 },
  { label: '5:30 PM', hours: 17, minutes: 30 },
  { label: '7:00 PM', hours: 19, minutes: 0 },
  { label: '9:30 PM', hours: 21, minutes: 30 },
];

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
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());

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
      setCalendarMonth(new Date(start.getFullYear(), start.getMonth(), 1));
    }
  }, [visible, initialDate, initialRepeat]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, [visible]);

  const handleTimeChange = (event: { type: string }, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
      if (event.type === 'dismissed') return;
    }
    if (selectedDate) {
      const updated = new Date(triggerDate);
      updated.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
      if (updated.getTime() <= Date.now()) {
        Alert.alert('Invalid Time', 'Please select a time in the future.');
        return;
      }
      setTriggerDate(updated);
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

  const todayStart = useMemo(() => {
    const current = new Date(now);
    current.setHours(0, 0, 0, 0);
    return current;
  }, [now]);

  const minMonth = useMemo(() => {
    return new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
  }, [todayStart]);

  const canGoPrev =
    calendarMonth.getFullYear() > minMonth.getFullYear() ||
    (calendarMonth.getFullYear() === minMonth.getFullYear() &&
      calendarMonth.getMonth() > minMonth.getMonth());

  const monthLabel = useMemo(() => {
    return calendarMonth.toLocaleDateString([], { month: 'long', year: 'numeric' });
  }, [calendarMonth]);

  const calendarWeeks = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks: Array<Array<Date | null>> = [];
    let day = 1 - startWeekday;

    while (day <= daysInMonth) {
      const week: Array<Date | null> = [];
      for (let i = 0; i < 7; i += 1) {
        if (day < 1 || day > daysInMonth) {
          week.push(null);
        } else {
          week.push(new Date(year, month, day));
        }
        day += 1;
      }
      weeks.push(week);
    }
    return weeks;
  }, [calendarMonth]);

  const selectDate = (date: Date) => {
    if (date.getTime() < todayStart.getTime()) return;
    const updated = new Date(triggerDate);
    updated.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
    updated.setSeconds(0, 0);
    setTriggerDate(updated);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={styles.overlay}
        onPress={onClose}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <Pressable style={styles.container} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Set Reminder</Text>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          </View>

          <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
            <View style={styles.section}>
              <ReminderPresetDropdown
                now={now}
                value={triggerDate}
                onSelect={(date) => setTriggerDate(date)}
                onInvalidSelection={(message) => Alert.alert('Invalid Time', message)}
              />

              <View style={styles.calendarCard}>
                <View style={styles.calendarHeader}>
                  <Pressable
                    style={[styles.calendarNav, !canGoPrev && styles.calendarNavDisabled]}
                    onPress={() => {
                      if (!canGoPrev) return;
                      setCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1),
                      );
                    }}
                    disabled={!canGoPrev}
                  >
                    <Ionicons
                      name="chevron-back"
                      size={22}
                      color={canGoPrev ? theme.colors.text : theme.colors.textMuted}
                    />
                  </Pressable>
                  <Text style={styles.calendarMonth}>{monthLabel}</Text>
                  <Pressable
                    style={styles.calendarNav}
                    onPress={() =>
                      setCalendarMonth(
                        new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1),
                      )
                    }
                  >
                    <Ionicons name="chevron-forward" size={22} color={theme.colors.text} />
                  </Pressable>
                </View>

                <View style={styles.weekdayRow}>
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                    <Text key={label} style={styles.weekdayText}>
                      {label}
                    </Text>
                  ))}
                </View>

                {calendarWeeks.map((week, weekIndex) => (
                  <View key={`week-${weekIndex}`} style={styles.weekRow}>
                    {week.map((day, dayIndex) => {
                      if (!day) {
                        return (
                          <View key={`empty-${weekIndex}-${dayIndex}`} style={styles.dayCell} />
                        );
                      }

                      const isSelected =
                        day.getFullYear() === triggerDate.getFullYear() &&
                        day.getMonth() === triggerDate.getMonth() &&
                        day.getDate() === triggerDate.getDate();
                      const isDisabled = day.getTime() < todayStart.getTime();

                      return (
                        <Pressable
                          key={`day-${dayIndex}`}
                          style={[
                            styles.dayCell,
                            isSelected && styles.dayCellSelected,
                            isDisabled && styles.dayCellDisabled,
                          ]}
                          onPress={() => selectDate(day)}
                          disabled={isDisabled}
                        >
                          <Text
                            style={[
                              styles.dayText,
                              isSelected && styles.dayTextSelected,
                              isDisabled && styles.dayTextDisabled,
                            ]}
                          >
                            {day.getDate()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>

              <View style={styles.presetsContainer}>
                <Pressable style={styles.timeButton} onPress={() => setShowTimePicker(true)}>
                  <Ionicons name="time-outline" size={16} color={theme.colors.primary} />
                  <Text style={styles.timeButtonText}>{formatTime(triggerDate)}</Text>
                </Pressable>
                {TIME_PRESETS.map((preset, index) => {
                  const isSelected =
                    triggerDate.getHours() === preset.hours &&
                    triggerDate.getMinutes() === preset.minutes;
                  const isTodaySelected =
                    triggerDate.getFullYear() === now.getFullYear() &&
                    triggerDate.getMonth() === now.getMonth() &&
                    triggerDate.getDate() === now.getDate();
                  const presetTotalMinutes = preset.hours * 60 + preset.minutes;
                  const nowTotalMinutes = now.getHours() * 60 + now.getMinutes();
                  const isDisabled = isTodaySelected && presetTotalMinutes <= nowTotalMinutes;
                  return (
                    <Pressable
                      key={index}
                      style={[
                        styles.presetChip,
                        isSelected && styles.presetChipSelected,
                        isDisabled && styles.presetChipDisabled,
                      ]}
                      onPress={() => {
                        const updated = new Date(triggerDate);
                        updated.setHours(preset.hours, preset.minutes, 0, 0);
                        setTriggerDate(updated);
                      }}
                      disabled={isDisabled}
                    >
                      <Text
                        style={[
                          styles.presetText,
                          isSelected && styles.presetTextSelected,
                          isDisabled && styles.presetTextDisabled,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.separator} />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Repeat</Text>
              <RecurrencePicker repeat={repeat} onChange={setRepeat} />
            </View>
          </ScrollView>

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

      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker
          value={triggerDate}
          mode="time"
          is24Hour={false}
          display="default"
          themeVariant={resolvedMode}
          onChange={handleTimeChange}
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
      paddingHorizontal: theme.spacing.md,
    },
    contentContainer: {
      paddingVertical: theme.spacing.sm,
      gap: theme.spacing.md,
    },
    section: {
      gap: theme.spacing.sm,
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
    },
    calendarCard: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    calendarHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    calendarNav: {
      padding: theme.spacing.sm,
      borderRadius: theme.borderRadius.sm,
    },
    calendarNavDisabled: {
      opacity: 0.5,
    },
    calendarMonth: {
      fontSize: theme.typography.sizes.base,
      fontWeight: theme.typography.weights.semibold as '600',
      color: theme.colors.text,
    },
    weekdayRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.xs,
    },
    weekdayText: {
      width: 32,
      textAlign: 'center',
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.textMuted,
    },
    weekRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.xs,
    },
    dayCell: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayCellSelected: {
      backgroundColor: theme.colors.primary,
    },
    dayCellDisabled: {
      opacity: 0.35,
    },
    dayText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
    },
    dayTextSelected: {
      color: 'white',
      fontWeight: '600',
    },
    dayTextDisabled: {
      color: theme.colors.textMuted,
    },
    presetsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    presetChip: {
      padding: 6,
      borderRadius: 8,
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    presetChipSelected: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    presetChipDisabled: {
      opacity: 0.4,
    },
    presetText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
    },
    presetTextSelected: {
      color: 'white',
    },
    presetTextDisabled: {
      color: theme.colors.textMuted,
    },
    timeRow: {
      gap: theme.spacing.xs,
    },
    timeRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.xs,
    },
    timeRowLabel: {
      flex: 1,
      fontSize: theme.typography.sizes.base,
      color: theme.colors.text,
      fontWeight: theme.typography.weights.semibold as '600',
    },
    timeRowValue: {
      fontSize: theme.typography.sizes.base,
      color: theme.colors.textMuted,
    },
    timePicker: {
      height: 140,
    },
    timeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      padding: 6,
      borderRadius: 8,
      backgroundColor: theme.colors.background,
      borderWidth: 1,
      borderColor: theme.colors.border,
    },
    timeButtonText: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
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
