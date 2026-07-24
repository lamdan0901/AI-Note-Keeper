import React, { useMemo, useState } from 'react';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import type { NoteColorPreset } from '../../services/notesTypes';

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
  noteColor: NoteColorPreset;
  /** Current reminder datetime; used to show matching preset as selected. */
  selectedDate?: Date | null;
  onSelect: (date: Date) => void;
};

function isSameDateTime(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function noteSurfaceBg(noteColor: NoteColorPreset): string {
  return `var(--note-color-${noteColor})`;
}

function buildPresetSelectStyles(noteColor: NoteColorPreset): StylesConfig<PresetOption, false> {
  const surface = noteSurfaceBg(noteColor);
  return {
    control: (base, state) => ({
      ...base,
      minHeight: 40,
      borderRadius: 10,
      borderColor: state.isFocused ? 'var(--color-accent)' : 'var(--modal-border-strong)',
      backgroundColor: surface,
      color: 'var(--modal-fg-primary)',
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
      backgroundColor: surface,
      color: 'var(--modal-fg-primary)',
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
      const interactiveBackground = 'var(--modal-hover-soft)';

      return {
        ...base,
        cursor: state.isDisabled ? 'not-allowed' : 'pointer',
        borderRadius: 8,
        color: state.isDisabled ? 'var(--modal-fg-placeholder)' : 'var(--modal-fg-primary)',
        backgroundColor:
          !state.isDisabled && (state.isSelected || state.isFocused)
            ? interactiveBackground
            : 'transparent',
        boxShadow:
          !state.isDisabled && (state.isSelected || state.isFocused)
            ? 'inset 0 0 0 1px var(--modal-border-strong)'
            : 'none',
        '&:hover': {
          backgroundColor: state.isDisabled ? 'transparent' : interactiveBackground,
          color: state.isDisabled ? 'var(--modal-fg-placeholder)' : 'var(--modal-fg-primary)',
          boxShadow: state.isDisabled ? 'none' : 'inset 0 0 0 1px var(--modal-border-strong)',
        },
        '&:active': {
          backgroundColor: interactiveBackground,
        },
      };
    },
  };
}

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
  noteColor,
  selectedDate = null,
  onSelect,
}: ReminderPresetDropdownProps): JSX.Element {
  // Host inside modal so --modal-fg / note surface vars resolve (not document.body).
  const [menuHost, setMenuHost] = useState<HTMLDivElement | null>(null);
  const styles = useMemo(() => buildPresetSelectStyles(noteColor), [noteColor]);

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

  const selectedOption = useMemo(() => {
    if (!selectedDate) return null;
    return options.find((option) => isSameDateTime(option.date, selectedDate)) ?? null;
  }, [options, selectedDate]);

  const handleChange = (selected: SingleValue<PresetOption>) => {
    if (!selected || selected.isDisabled) return;
    onSelect(new Date(selected.date));
  };

  return (
    <div className="reminder-preset">
      <Select<PresetOption, false>
        inputId="reminder-preset-select"
        className="reminder-preset__select"
        aria-label="Preset"
        options={options}
        value={selectedOption}
        onChange={handleChange}
        isSearchable={false}
        placeholder="Preset"
        styles={styles}
        menuPortalTarget={menuHost ?? undefined}
        menuPosition={menuHost ? 'fixed' : 'absolute'}
      />
      <div ref={setMenuHost} className="reminder-preset__menu-host" />
    </div>
  );
}
