import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';

type PresetTimeKey = 'morning' | 'afternoon' | 'evening' | 'night';

export type ReminderPresetGroup = 'today' | 'tomorrow';

export type ReminderPresetOption = {
  id: string;
  group: ReminderPresetGroup;
  title: string;
  timeLabel: string;
  date: Date;
};

const PRESET_TIMES: Array<{ key: PresetTimeKey; label: string; hour: number; minute: number }> = [
  { key: 'morning', label: 'Morning', hour: 7, minute: 0 },
  { key: 'afternoon', label: 'Afternoon', hour: 12, minute: 0 },
  { key: 'evening', label: 'Evening', hour: 18, minute: 0 },
  { key: 'night', label: 'Night', hour: 20, minute: 0 },
];

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (date: Date, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
};

const atTime = (day: Date, hour: number, minute: number) => {
  const d = new Date(day);
  d.setHours(hour, minute, 0, 0);
  return d;
};

const isSameMinute = (a: Date, b: Date) =>
  Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const buildReminderPresetOptions = (
  now: Date,
): { today: ReminderPresetOption[]; tomorrow: ReminderPresetOption[] } => {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const todayOptionsAll: ReminderPresetOption[] = PRESET_TIMES.map((preset) => {
    const date = atTime(today, preset.hour, preset.minute);
    return {
      id: `today:${preset.key}`,
      group: 'today',
      title: preset.label,
      timeLabel: formatTime(date),
      date,
    };
  });

  const todayOptions = todayOptionsAll.filter((option) => option.date.getTime() > now.getTime());

  const tomorrowOptions: ReminderPresetOption[] = PRESET_TIMES.map((preset) => {
    const date = atTime(tomorrow, preset.hour, preset.minute);
    return {
      id: `tomorrow:${preset.key}`,
      group: 'tomorrow',
      title: preset.label,
      timeLabel: formatTime(date),
      date,
    };
  });

  return { today: todayOptions, tomorrow: tomorrowOptions };
};

export interface ReminderPresetDropdownProps {
  now: Date;
  value: Date;
  onSelect: (date: Date) => void;
  onInvalidSelection?: (message: string) => void;
}

export const ReminderPresetDropdown: React.FC<ReminderPresetDropdownProps> = ({
  now,
  value,
  onSelect,
  onInvalidSelection,
}) => {
  const [open, setOpen] = useState(false);
  const presetGroups = useMemo(() => buildReminderPresetOptions(now), [now]);
  const allOptions = useMemo(
    () => [...presetGroups.today, ...presetGroups.tomorrow],
    [presetGroups.today, presetGroups.tomorrow],
  );

  const selectedOption = useMemo(() => {
    return allOptions.find((option) => isSameMinute(option.date, value)) || null;
  }, [allOptions, value]);

  const handleSelect = (option: ReminderPresetOption) => {
    if (option.date.getTime() <= now.getTime()) {
      onInvalidSelection?.('That time is in the past. Please choose another option.');
      return;
    }
    setOpen(false);
    onSelect(new Date(option.date));
  };

  return (
    <>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <View style={styles.triggerLeft}>
          <Ionicons name="flash-outline" size={18} color={theme.colors.primary} />
          <Text style={styles.triggerTitle}>Presets</Text>
        </View>
        <View style={styles.triggerRight}>
          <Text style={styles.triggerValue}>
            {selectedOption
              ? `${selectedOption.group === 'today' ? 'Today' : 'Tomorrow'} + ${
                  selectedOption.title
                } (${selectedOption.timeLabel})`
              : 'Custom'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={theme.colors.textMuted} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose a preset</Text>

            {presetGroups.today.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Today</Text>
                {presetGroups.today.map((option) => (
                  <Pressable
                    key={option.id}
                    style={styles.optionRow}
                    onPress={() => handleSelect(option)}
                  >
                    <Text style={styles.optionText}>
                      {option.title} ({option.timeLabel})
                    </Text>
                  </Pressable>
                ))}
                <View style={styles.groupSpacer} />
              </>
            )}

            <Text style={styles.groupLabel}>Tomorrow</Text>
            {presetGroups.tomorrow.map((option) => (
              <Pressable
                key={option.id}
                style={styles.optionRow}
                onPress={() => handleSelect(option)}
              >
                <Text style={styles.optionText}>
                  {option.title} ({option.timeLabel})
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    padding: theme.spacing.sm,
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  triggerTitle: {
    fontSize: theme.typography.sizes.base,
    color: theme.colors.text,
    fontWeight: '600',
  },
  triggerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    justifyContent: 'flex-end',
  },
  triggerValue: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.textMuted,
    flexShrink: 1,
    textAlign: 'right',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: theme.spacing.md,
  },
  modalCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    ...theme.shadows.md,
  },
  modalTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold as '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
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
  groupSpacer: {
    height: 8,
  },
  optionRow: {
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.md,
  },
  optionText: {
    color: theme.colors.text,
    fontSize: theme.typography.sizes.base,
  },
});
