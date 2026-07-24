import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { RepeatRule } from '../../services/notesTypes';
import { formatReminder, getInitialReminderDate } from '../../services/reminderUtils';
import { ReminderPresetDropdown } from './ReminderPresetDropdown';
import { RecurrencePicker } from './RecurrencePicker';

export type ReminderSetupPanelProps = {
  reminder: Date | null;
  repeat: RepeatRule | null;
  now?: Date;
  onChange: (payload: { reminder: Date | null; repeat: RepeatRule | null }) => void;
};

const QUICK_TIMES: Array<{ label: string; hour: number; minute: number }> = [
  { label: '6:30 AM', hour: 6, minute: 30 },
  { label: '9:00 AM', hour: 9, minute: 0 },
  { label: '11:30 AM', hour: 11, minute: 30 },
  { label: '3:00 PM', hour: 15, minute: 0 },
  { label: '5:30 PM', hour: 17, minute: 30 },
  { label: '7:00 PM', hour: 19, minute: 0 },
  { label: '9:30 PM', hour: 21, minute: 30 },
];

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toTimeInputValue(value: Date): string {
  const hours = `${value.getHours()}`.padStart(2, '0');
  const minutes = `${value.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function startOfDay(value: Date): Date {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(value: Date): Date {
  const next = new Date(value);
  next.setDate(1);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addMonths(value: Date, amount: number): Date {
  const next = new Date(value);
  next.setMonth(next.getMonth() + amount);
  return startOfMonth(next);
}

function isSameDate(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function buildCalendarDays(monthStart: Date): Date[] {
  const calendarStart = new Date(monthStart);
  calendarStart.setDate(monthStart.getDate() - ((monthStart.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(calendarStart);
    day.setDate(calendarStart.getDate() + index);
    return day;
  });
}

function withTime(value: Date, nextTime: string): Date {
  const [hours, minutes] = nextTime.split(':').map(Number);
  const next = new Date(value);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function withQuickTime(value: Date, hour: number, minute: number): Date {
  const next = new Date(value);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function repeatKey(value: RepeatRule | null): string {
  return value ? JSON.stringify(value) : 'null';
}

export function ReminderSetupPanel({
  reminder,
  repeat,
  now,
  onChange,
}: ReminderSetupPanelProps): JSX.Element {
  const calendarRef = useRef<HTMLElement>(null);
  const providedNow = useMemo(() => (now ? new Date(now) : null), [now]);
  const [liveNow, setLiveNow] = useState<Date>(() => providedNow ?? new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    getInitialReminderDate(reminder, providedNow ?? new Date()),
  );
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(selectedDate));
  const [repeatState, setRepeatState] = useState<RepeatRule | null>(repeat);

  useEffect(() => {
    if (providedNow) {
      setLiveNow(providedNow);
      return;
    }
    const timer = window.setInterval(() => setLiveNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [providedNow]);

  const reminderMs = reminder?.getTime() ?? null;
  const repeatSerialized = repeatKey(repeat);

  // Sync local UI when parent draft reminder/repeat changes (open edit / clear from parent).
  useEffect(() => {
    const nextSelected = getInitialReminderDate(reminder, providedNow ?? new Date());
    setSelectedDate(nextSelected);
    setViewMonth(startOfMonth(nextSelected));
    setRepeatState(repeat);
    // reminder/repeat objects are summarized via reminderMs + repeatSerialized
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controlled sync on draft identity
  }, [reminderMs, repeatSerialized, providedNow]);

  useEffect(() => {
    const calendarElement = calendarRef.current;
    if (!calendarElement) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      setViewMonth((prev) => addMonths(prev, event.deltaY > 0 ? 1 : -1));
    };

    calendarElement.addEventListener('wheel', handleWheel, { passive: false });
    return () => calendarElement.removeEventListener('wheel', handleWheel);
  }, []);

  const todayStart = useMemo(() => startOfDay(liveNow), [liveNow]);
  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);

  const error =
    reminder !== null && reminder.getTime() <= liveNow.getTime()
      ? 'Reminder time must be in the future.'
      : null;
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(viewMonth);
  const reminderLabel = reminder ? formatReminder(reminder, repeat) : null;

  const commit = (nextDate: Date, nextRepeat: RepeatRule | null) => {
    setSelectedDate(nextDate);
    setRepeatState(nextRepeat);
    setViewMonth(startOfMonth(nextDate));
    onChange({ reminder: nextDate, repeat: nextRepeat });
  };

  const handleClear = () => {
    const nextSelected = getInitialReminderDate(null, providedNow ?? new Date());
    setSelectedDate(nextSelected);
    setViewMonth(startOfMonth(nextSelected));
    setRepeatState(null);
    onChange({ reminder: null, repeat: null });
  };

  const handleSelectDay = (day: Date) => {
    if (day.getTime() < todayStart.getTime()) {
      return;
    }
    const next = new Date(selectedDate);
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    commit(next, repeatState);
  };

  return (
    <section className="reminder-setup-panel" aria-label="Reminder">
      <div className="reminder-setup-panel__header">
        <h3 className="reminder-setup-panel__title">Reminder</h3>
        {reminder ? (
          <button
            type="button"
            className="modal-dialog__reminder-clear"
            onClick={handleClear}
            aria-label="Clear reminder"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>

      {reminderLabel ? (
        <p className="reminder-setup-panel__status">{reminderLabel}</p>
      ) : (
        <p className="reminder-setup-panel__status reminder-setup-panel__status--empty">
          No reminder
        </p>
      )}

      <ReminderPresetDropdown now={liveNow} onSelect={(date) => commit(date, repeatState)} />

      <section ref={calendarRef} className="reminder-calendar" aria-label="Reminder date">
        <div className="reminder-calendar__header">
          <button
            className="reminder-calendar__month-btn"
            type="button"
            onClick={() => setViewMonth((prev) => addMonths(prev, -1))}
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <p className="reminder-calendar__month-label">{monthLabel}</p>
          <button
            className="reminder-calendar__month-btn"
            type="button"
            onClick={() => setViewMonth((prev) => addMonths(prev, 1))}
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="reminder-calendar__weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className="reminder-calendar__grid">
          {calendarDays.map((day) => {
            const isOutsideMonth = day.getMonth() !== viewMonth.getMonth();
            const isDisabled = day.getTime() < todayStart.getTime();
            const isToday = isSameDate(day, todayStart);
            const isSelected = isSameDate(day, selectedDate);
            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={isDisabled}
                onClick={() => handleSelectDay(day)}
                className={`reminder-calendar__day${
                  isOutsideMonth ? ' reminder-calendar__day--outside' : ''
                }${isToday ? ' reminder-calendar__day--today' : ''}${
                  isSelected ? ' reminder-calendar__day--selected' : ''
                }`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </section>

      <div className="reminder-setup-modal__time-group">
        <span className="reminder-setup-modal__time-label">Time</span>
        <div className="reminder-setup-modal__quick-times">
          <input
            type="time"
            className="reminder-setup-modal__chip reminder-setup-modal__chip--time-input"
            aria-label="Custom time"
            value={toTimeInputValue(selectedDate)}
            onChange={(event) => commit(withTime(selectedDate, event.target.value), repeatState)}
          />
          {QUICK_TIMES.map((slot) => {
            const candidate = withQuickTime(selectedDate, slot.hour, slot.minute);
            const disabled =
              candidate.getTime() <= liveNow.getTime() &&
              candidate.toDateString() === liveNow.toDateString();
            const isSelectedTime =
              selectedDate.getHours() === slot.hour && selectedDate.getMinutes() === slot.minute;
            return (
              <button
                key={slot.label}
                type="button"
                disabled={disabled}
                className={`reminder-setup-modal__chip${
                  isSelectedTime ? ' reminder-setup-modal__chip--active' : ''
                }`}
                aria-pressed={isSelectedTime}
                onClick={() => commit(candidate, repeatState)}
              >
                {slot.label}
              </button>
            );
          })}
        </div>
      </div>

      <RecurrencePicker
        value={repeatState}
        onChange={(nextRepeat) => commit(selectedDate, nextRepeat)}
        selectedDate={selectedDate}
      />

      {error && <p className="reminder-setup-modal__error">{error}</p>}
    </section>
  );
}
