import React, { useMemo } from 'react';
import Select, { type SingleValue, type StylesConfig } from 'react-select';

type PresetId =
  | 'today_morning'
  | 'today_afternoon'
  | 'today_evening'
  | 'today_night'
  | 'tomorrow_morning'
  | 'tomorrow_afternoon'
  | 'tomorrow_evening'
  | 'tomorrow_night';

type PresetOption = {
  value: PresetId;
  label: string;
  date: Date;
  isDisabled: boolean;
};

type ReminderPresetDropdownProps = {
  now: Date;
  onSelect: (date: Date) => void;
};

const PRESET_SLOTS: Array<{
  id: 'morning' | 'afternoon' | 'evening' | 'night';
  label: string;
  hour: number;
}> = [
  { id: 'morning', label: 'Morning', hour: 9 },
  { id: 'afternoon', label: 'Afternoon', hour: 15 },
  { id: 'evening', label: 'Evening', hour: 19 },
  { id: 'night', label: 'Night', hour: 21 },
];

const PRESET_SELECT_STYLES: StylesConfig<PresetOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    borderRadius: 10,
    borderColor: state.isFocused ? 'var(--color-accent)' : 'var(--modal-border-strong)',
    backgroundColor: 'var(--note-color-default)',
    boxShadow: state.isFocused ? '0 0 0 2px var(--color-accent-soft)' : 'none',
    '&:hover': {
      borderColor: state.isFocused ? 'var(--color-accent)' : 'var(--modal-border-strong)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '2px 10px',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--modal-fg-placeholder)',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--modal-fg-primary)',
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--modal-fg-primary)',
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    color: state.isFocused ? 'var(--color-accent)' : 'var(--modal-fg-secondary)',
    '&:hover': {
      color: 'var(--color-accent)',
    },
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  menu: (base) => ({
    ...base,
    marginTop: 6,
    border: '1px solid var(--modal-border-soft)',
    borderRadius: 10,
    backgroundColor: 'var(--note-color-default)',
    boxShadow: 'var(--shadow-card)',
    overflow: 'hidden',
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 140,
  }),
  menuList: (base) => ({
    ...base,
    padding: 4,
  }),
  option: (base, state) => {
    const interactiveBackground = 'var(--color-accent-soft)';

    return {
      ...base,
      cursor: state.isDisabled ? 'not-allowed' : 'pointer',
      borderRadius: 8,
      color: state.isDisabled ? 'var(--color-text-muted)' : 'var(--modal-fg-primary)',
      backgroundColor:
        !state.isDisabled && (state.isSelected || state.isFocused) ? interactiveBackground : 'transparent',
      boxShadow:
        !state.isDisabled && (state.isSelected || state.isFocused)
          ? 'inset 0 0 0 1px rgba(123, 77, 255, 0.38)'
          : 'none',
      '&:hover': {
        backgroundColor: state.isDisabled ? 'transparent' : interactiveBackground,
        color: state.isDisabled ? 'var(--color-text-muted)' : 'var(--modal-fg-primary)',
        boxShadow: state.isDisabled ? 'none' : 'inset 0 0 0 1px rgba(123, 77, 255, 0.38)',
      },
      '&:active': {
        backgroundColor: interactiveBackground,
      },
    };
  },
};

function makePresetDate(base: Date, dayOffset: number, hour: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + dayOffset);
  next.setHours(hour, 0, 0, 0);
  return next;
}

function formatTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function ReminderPresetDropdown({
  now,
  onSelect,
}: ReminderPresetDropdownProps): JSX.Element {
  const menuPortalTarget = typeof document === 'undefined' ? undefined : document.body;

  const options = useMemo<PresetOption[]>(() => {
    const today = PRESET_SLOTS.map((slot) => {
      const date = makePresetDate(now, 0, slot.hour);
      return {
        value: `today_${slot.id}` as PresetId,
        label: `Today, ${slot.label} (${formatTimeLabel(date)})`,
        date,
        isDisabled: date.getTime() <= now.getTime(),
      };
    });
    const tomorrow = PRESET_SLOTS.map((slot) => {
      const date = makePresetDate(now, 1, slot.hour);
      return {
        value: `tomorrow_${slot.id}` as PresetId,
        label: `Tomorrow, ${slot.label} (${formatTimeLabel(date)})`,
        date,
        isDisabled: false,
      };
    });
    return [...today, ...tomorrow].filter((option) => !option.isDisabled);
  }, [now]);

  const handleChange = (selected: SingleValue<PresetOption>) => {
    if (!selected || selected.isDisabled) return;
    onSelect(new Date(selected.date));
  };

  return (
    <div className="reminder-preset">
      <label className="reminder-preset__label" htmlFor="reminder-preset-select">
        Preset
      </label>
      <Select<PresetOption, false>
        inputId="reminder-preset-select"
        className="reminder-preset__select"
        options={options}
        value={null}
        onChange={handleChange}
        isSearchable={false}
        placeholder="Quick pick"
        styles={PRESET_SELECT_STYLES}
        menuPortalTarget={menuPortalTarget}
        menuPosition={menuPortalTarget ? 'fixed' : 'absolute'}
      />
    </div>
  );
}
