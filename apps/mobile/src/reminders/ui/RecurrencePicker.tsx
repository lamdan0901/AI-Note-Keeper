import React, { useMemo } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { type Theme, useTheme } from '../../theme';
import { RepeatRule } from '../../../../../packages/shared/types/reminder';

interface RecurrencePickerProps {
  repeat: RepeatRule | null;
  onChange: (rule: RepeatRule | null) => void;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export const RecurrencePicker: React.FC<RecurrencePickerProps> = ({ repeat, onChange }) => {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const testKind = 'test-3-min';
  const currentKind =
    repeat?.kind === 'custom' && repeat.frequency === 'minutes' && repeat.interval === 3
      ? testKind
      : repeat?.kind || 'none';

  // Helper to safely update
  const setKind = (kind: string) => {
    if (kind === 'none') {
      onChange(null);
    } else if (kind === 'daily') {
      onChange({ kind: 'daily', interval: 1 });
    } else if (kind === 'weekly') {
      onChange({ kind: 'weekly', interval: 1, weekdays: [new Date().getDay()] }); // Default to today
    } else if (kind === 'monthly') {
      onChange({ kind: 'monthly', interval: 1, mode: 'day_of_month' });
    } else if (kind === testKind) {
      onChange({ kind: 'custom', interval: 3, frequency: 'minutes' });
    } else if (kind === 'custom') {
      onChange({ kind: 'custom', interval: 1, frequency: 'days' });
    }
  };

  const toggleWeekday = (dayIndex: number) => {
    if (currentKind !== 'weekly' || !repeat || repeat.kind !== 'weekly') return;
    const currentDays = repeat.weekdays || [];
    let newDays;
    if (currentDays.includes(dayIndex)) {
      newDays = currentDays.filter((d: number) => d !== dayIndex);
    } else {
      newDays = [...currentDays, dayIndex].sort();
    }

    // Don't allow empty weekdays? Or maybe implied "every week" if empty?
    // Usually repeat requires at least one day.
    if (newDays.length === 0) return;

    onChange({ ...repeat, weekdays: newDays });
  };

  return (
    <View style={styles.container}>
      {/* Type Selector Tabs */}
      <View style={styles.tabs}>
        {(['none', 'daily', 'weekly', 'monthly', testKind] as const).map((kind) => (
          <Pressable
            key={kind}
            style={[styles.tab, currentKind === kind && styles.tabActive]}
            onPress={() => setKind(kind)}
          >
            <Text style={[styles.tabText, currentKind === kind && styles.tabTextActive]}>
              {kind === testKind ? '3 min' : kind.charAt(0).toUpperCase() + kind.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Detail Views */}
      {currentKind === 'weekly' && repeat?.kind === 'weekly' && (
        <View style={styles.details}>
          <Text style={styles.label}>Repeat on</Text>
          <View style={styles.weekdays}>
            {WEEKDAYS.map((day, index) => {
              const isSelected = repeat.weekdays.includes(index);
              return (
                <Pressable
                  key={index}
                  style={[styles.dayCircle, isSelected && styles.dayCircleActive]}
                  onPress={() => toggleWeekday(index)}
                >
                  <Text style={[styles.dayText, isSelected && styles.dayTextActive]}>{day}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {currentKind === 'monthly' && (
        <View style={styles.details}>
          <Text style={styles.hint}>Will repeat on the same day each month.</Text>
        </View>
      )}

      {currentKind === testKind && (
        <View style={styles.details}>
          <Text style={styles.hint}>Repeats every 3 minutes.</Text>
        </View>
      )}

      {currentKind === 'none' && (
        <View style={styles.details}>
          <Text style={styles.hint}>Does not repeat.</Text>
        </View>
      )}

      {/* TODO: Custom implementation if needed later, kept simple for now per specs */}
    </View>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    container: {
      gap: theme.spacing.md,
    },
    tabs: {
      flexDirection: 'row',
      backgroundColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      padding: 2,
    },
    tab: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center',
      borderRadius: theme.borderRadius.sm,
    },
    tabActive: {
      backgroundColor: theme.colors.surface,
      ...theme.shadows.sm,
    },
    tabText: {
      fontSize: 13,
      color: theme.colors.textMuted,
      fontWeight: '500',
    },
    tabTextActive: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    details: {
      marginTop: theme.spacing.xs,
    },
    label: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
      fontWeight: '500',
      marginBottom: theme.spacing.sm,
    },
    hint: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontStyle: 'italic',
    },
    weekdays: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    dayCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.colors.border,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
    },
    dayCircleActive: {
      backgroundColor: theme.colors.primary,
      borderColor: theme.colors.primary,
    },
    dayText: {
      fontSize: 12,
      color: theme.colors.textMuted,
      fontWeight: '500',
    },
    dayTextActive: {
      color: 'white',
      fontWeight: '600',
    },
  });
