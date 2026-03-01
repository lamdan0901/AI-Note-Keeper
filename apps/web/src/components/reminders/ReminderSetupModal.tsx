import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { RepeatRule } from '../../services/notesTypes';
import { getInitialReminderDate } from '../../services/reminderUtils';
import { ReminderPresetDropdown } from './ReminderPresetDropdown';
import { RecurrencePicker } from './RecurrencePicker';

type ReminderSetupModalProps = {
  initialDate?: Date | null;
  initialRepeat?: RepeatRule | null;
  now?: Date;
  onSave: (payload: { reminder: Date; repeat: RepeatRule | null }) => void;
  onClose: () => void;
};

const QUICK_TIMES: Array<{ label: string; hour: number; minute: number }> = [
  { label: '6:30', hour: 6, minute: 30 },
  { label: '9:00', hour: 9, minute: 0 },
  { label: '11:30', hour: 11, minute: 30 },
  { label: '3:00', hour: 15, minute: 0 },
  { label: '5:30', hour: 17, minute: 30 },
  { label: '7:00', hour: 19, minute: 0 },
  { label: '9:30', hour: 21, minute: 30 },
];

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  calendarStart.setDate(monthStart.getDate() - monthStart.getDay());
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

export function ReminderSetupModal({
  initialDate = null,
  initialRepeat = null,
  now,
  onSave,
  onClose,
}: ReminderSetupModalProps): JSX.Element {
  const providedNow = useMemo(() => (now ? new Date(now) : null), [now]);
  const [liveNow, setLiveNow] = useState<Date>(() => providedNow ?? new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(() =>
    getInitialReminderDate(initialDate, providedNow ?? new Date()),
  );
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(selectedDate));
  const [repeat, setRepeat] = useState<RepeatRule | null>(initialRepeat);

  useEffect(() => {
    if (providedNow) {
      setLiveNow(providedNow);
      return;
    }
    const timer = window.setInterval(() => setLiveNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, [providedNow]);

  const todayStart = useMemo(() => startOfDay(liveNow), [liveNow]);
  const calendarDays = useMemo(() => buildCalendarDays(viewMonth), [viewMonth]);

  const isPast = selectedDate.getTime() <= liveNow.getTime();
  const error = isPast ? 'Reminder time must be in the future.' : null;
  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(viewMonth);

  const handleSelectDay = (day: Date) => {
    if (day.getTime() < todayStart.getTime()) {
      return;
    }
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
      return next;
    });
    setViewMonth(startOfMonth(day));
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Set reminder"
      onClick={onClose}
    >
      <div
        className="modal-dialog reminder-setup-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-dialog__header">
          <h3 className="reminder-setup-modal__title">Set reminder</h3>
          <button
            className="modal-dialog__close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close reminder"
          >
            <X size={18} />
          </button>
        </div>

        <ReminderPresetDropdown
          now={liveNow}
          onSelect={(date) => {
            setSelectedDate(date);
            setViewMonth(startOfMonth(date));
          }}
        />

        <section
          className="reminder-calendar"
          aria-label="Reminder date"
          onWheel={(event) => {
            event.preventDefault();
            setViewMonth((prev) => addMonths(prev, event.deltaY > 0 ? 1 : -1));
          }}
        >
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
              onChange={(event) => setSelectedDate((prev) => withTime(prev, event.target.value))}
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
                  onClick={() => setSelectedDate(candidate)}
                >
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>

        <RecurrencePicker value={repeat} onChange={setRepeat} selectedDate={selectedDate} />

        {error && <p className="reminder-setup-modal__error">{error}</p>}

        <div className="modal-dialog__footer-actions reminder-setup-modal__actions">
          <button className="modal-dialog__done-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="modal-dialog__save-btn"
            type="button"
            disabled={Boolean(error)}
            onClick={() => {
              const comparisonNow = providedNow ?? new Date();
              if (!providedNow) {
                setLiveNow(comparisonNow);
              }
              if (selectedDate.getTime() <= comparisonNow.getTime()) return;
              onSave({ reminder: selectedDate, repeat });
            }}
          >
            Save reminder
          </button>
        </div>
      </div>
    </div>
  );
}
