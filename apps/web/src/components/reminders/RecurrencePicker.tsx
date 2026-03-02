import React, { useMemo } from 'react';
import type { RepeatRule } from '../../services/notesTypes';

type RecurrencePickerProps = {
  value: RepeatRule | null;
  onChange: (next: RepeatRule | null) => void;
  selectedDate: Date;
};

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function getActiveTab(value: RepeatRule | null): 'none' | 'daily' | 'weekly' | 'monthly' | 'custom' {
  if (!value) return 'none';
  return value.kind;
}

export function RecurrencePicker({ value, onChange, selectedDate }: RecurrencePickerProps): JSX.Element {
  const activeTab = getActiveTab(value);
  const weeklyWeekdays = useMemo(() => {
    if (value?.kind !== 'weekly') return [selectedDate.getDay()];
    return value.weekdays;
  }, [selectedDate, value]);
  const tabs = [
    { value: 'none', label: 'None' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'custom', label: 'Custom' },
  ] as const;

  return (
    <section className="recurrence-picker" aria-label="Repeat">
      <div className="recurrence-picker__header">
        <p className="recurrence-picker__title">Repeat</p>
        <div className="recurrence-picker__tabs" role="tablist" aria-label="Repeat options">
          {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            className={`recurrence-picker__tab${activeTab === tab.value ? ' recurrence-picker__tab--active' : ''}`}
            aria-selected={activeTab === tab.value}
            onClick={() => {
              if (tab.value === 'none') onChange(null);
              if (tab.value === 'daily') onChange({ kind: 'daily', interval: 1 });
              if (tab.value === 'weekly') onChange({ kind: 'weekly', interval: 1, weekdays: [selectedDate.getDay()] });
              if (tab.value === 'monthly') onChange({ kind: 'monthly', interval: 1, mode: 'day_of_month' });
              if (tab.value === 'custom') onChange({ kind: 'custom', interval: 2, frequency: 'days' });
            }}
          >
            {tab.label}
          </button>
          ))}
        </div>
      </div>

      {value?.kind === 'weekly' && (
        <div className="recurrence-picker__weekly">
          <div className="recurrence-picker__weekdays">
            {WEEKDAYS.map((label, index) => {
              const isActive = weeklyWeekdays.includes(index);
              return (
                <button
                  key={`${label}-${index}`}
                  type="button"
                  className={`recurrence-picker__weekday${isActive ? ' recurrence-picker__weekday--active' : ''}`}
                  onClick={() => {
                    if (value.kind !== 'weekly') return;
                    const next = isActive
                      ? value.weekdays.filter((d) => d !== index)
                      : [...value.weekdays, index].sort((a, b) => a - b);
                    if (next.length === 0) return;
                    onChange({ ...value, weekdays: next });
                  }}
                  aria-pressed={isActive}
                  aria-label={`Weekday ${label}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value?.kind === 'custom' && (
        <label className="recurrence-picker__custom">
          <span>Every</span>
          <input
            type="number"
            min={2}
            value={value.interval}
            onChange={(event) => {
              const interval = Math.max(2, Number(event.target.value) || 2);
              onChange({ ...value, interval, frequency: 'days' });
            }}
          />
          <span>days</span>
        </label>
      )}
    </section>
  );
}
