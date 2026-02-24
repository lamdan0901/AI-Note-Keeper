import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View, Pressable, TextInput } from 'react-native';
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
  const minCustomDays = 2;
  const isCustomDays = repeat?.kind === 'daily' && repeat.interval >= minCustomDays;
  const currentKind = isCustomDays ? 'custom' : repeat?.kind || 'none';
  const [customDaysText, setCustomDaysText] = useState(
    isCustomDays ? String(repeat?.interval ?? minCustomDays) : String(minCustomDays),
  );

  useEffect(() => {
    if (isCustomDays) {
      setCustomDaysText(String(repeat?.interval ?? minCustomDays));
    } else if (currentKind !== 'custom') {
      setCustomDaysText(String(minCustomDays));
    }
  }, [currentKind, isCustomDays, minCustomDays, repeat?.interval]);

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
    } else if (kind === 'custom') {
      onChange({ kind: 'daily', interval: minCustomDays });
      setCustomDaysText(String(minCustomDays));
    }
  };

  const parseCustomDays = (text: string) => {
    const parsed = Number.parseInt(text, 10);
    if (Number.isNaN(parsed)) return minCustomDays;
    return Math.max(minCustomDays, parsed);
  };

  const commitCustomDays = (text: string) => {
    const interval = parseCustomDays(text);
    setCustomDaysText(String(interval));
    onChange({ kind: 'daily', interval });
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
        {(['none', 'daily', 'weekly', 'monthly', 'custom'] as const).map((kind) => (
          <Pressable
            key={kind}
            style={[styles.tab, currentKind === kind && styles.tabActive]}
            onPress={() => setKind(kind)}
          >
            <Text style={[styles.tabText, currentKind === kind && styles.tabTextActive]}>
              {kind === 'custom' ? 'Custom' : kind.charAt(0).toUpperCase() + kind.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Detail Views */}
      {currentKind === 'weekly' && repeat?.kind === 'weekly' && (
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
      )}

      {currentKind === 'monthly' && (
        <View style={styles.details}>
          <Text style={styles.hint}>Will repeat on the same day each month.</Text>
        </View>
      )}

      {currentKind === 'custom' && (
        <View style={styles.details}>
          <View style={styles.intervalRow}>
            <Text style={styles.label}>Repeat every</Text>
            <TextInput
              style={styles.intervalInput}
              value={customDaysText}
              keyboardType="number-pad"
              selectTextOnFocus
              onChangeText={(text) => setCustomDaysText(text.replace(/[^0-9]/g, ''))}
              onEndEditing={(event) => commitCustomDays(event.nativeEvent.text)}
              placeholder={String(minCustomDays)}
            />
            <Text style={styles.intervalSuffix}>days</Text>
          </View>
          <Text style={styles.hint}>Minimum 2 days. Starts from the start date.</Text>
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
      marginBottom: theme.spacing.xs,
    },
    label: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
      fontWeight: '500',
      marginBottom: theme.spacing.sm,
    },
    hint: {
      marginTop: theme.spacing.xs,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.textMuted,
      fontStyle: 'italic',
    },
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    intervalInput: {
      minWidth: 40,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      color: theme.colors.text,
      backgroundColor: theme.colors.surface,
      textAlign: 'center',
      fontSize: theme.typography.sizes.sm,
    },
    intervalSuffix: {
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.text,
    },
    weekdays: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.xs,
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
