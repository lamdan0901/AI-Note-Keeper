import React, { useState, useEffect, useCallback, useRef } from 'react';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import { X } from 'lucide-react';
import type {
  Subscription,
  SubscriptionCreate,
  SubscriptionUpdate,
  BillingCycle,
  SubscriptionCategory,
  SubscriptionStatus,
} from '../../../../../packages/shared/types/subscription';
import { SERVICE_PRESETS } from '../../constants/servicePresets';
import { USER_ID } from '../../services/subscriptions';

interface SubscriptionEditorModalProps {
  subscription: Subscription | null;
  existingCategories: SubscriptionCategory[];
  onSave: (data: SubscriptionCreate | SubscriptionUpdate) => void;
  onClose: () => void;
}

const REMINDER_OPTIONS = [1, 3, 7] as const;

const BILLING_CYCLE_OPTIONS: { value: BillingCycle; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'custom', label: 'Custom' },
];

const STATUS_OPTIONS: { value: SubscriptionStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'cancelled', label: 'Cancelled' },
];

type SelectOption<T extends string> = { value: T; label: string };

const SUB_SELECT_STYLES: StylesConfig<SelectOption<string>, false> = {
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
      cursor: 'pointer',
      borderRadius: 8,
      color: 'var(--modal-fg-primary)',
      backgroundColor: state.isSelected || state.isFocused ? interactiveBackground : 'transparent',
      boxShadow:
        state.isSelected || state.isFocused ? 'inset 0 0 0 1px rgba(123, 77, 255, 0.38)' : 'none',
      '&:hover': {
        backgroundColor: interactiveBackground,
        color: 'var(--modal-fg-primary)',
        boxShadow: 'inset 0 0 0 1px rgba(123, 77, 255, 0.38)',
      },
      '&:active': {
        backgroundColor: interactiveBackground,
      },
    };
  },
};

function epochToDateInput(epoch?: number): string {
  if (!epoch) return '';
  const d = new Date(epoch);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateInputToEpoch(val: string): number {
  const [y, m, d] = val.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function todayDateInput(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function SubscriptionEditorModal({
  subscription,
  existingCategories,
  onSave,
  onClose,
}: SubscriptionEditorModalProps) {
  const isNew = subscription === null;
  const dialogRef = useRef<HTMLDivElement>(null);
  const minAllowedDate = todayDateInput();

  const [serviceName, setServiceName] = useState(subscription?.serviceName ?? '');
  const [category, setCategory] = useState<SubscriptionCategory>(subscription?.category ?? '');
  const [price, setPrice] = useState(subscription?.price?.toString() ?? '');
  const [currency, setCurrency] = useState(subscription?.currency ?? 'USD');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    subscription?.billingCycle ?? 'monthly',
  );
  const [customDays, setCustomDays] = useState(
    subscription?.billingCycleCustomDays?.toString() ?? '',
  );
  const [nextBillingDate, setNextBillingDate] = useState(
    epochToDateInput(subscription?.nextBillingDate),
  );
  const [trialEndDate, setTrialEndDate] = useState(epochToDateInput(subscription?.trialEndDate));
  const [status, setStatus] = useState<SubscriptionStatus>(subscription?.status ?? 'active');
  const [notes, setNotes] = useState(subscription?.notes ?? '');
  const [reminderDays, setReminderDays] = useState<number[]>(
    subscription?.reminderDaysBefore ?? [3],
  );

  const [showPresets, setShowPresets] = useState(false);
  const [presetFilter, setPresetFilter] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [serviceNameTouched, setServiceNameTouched] = useState(false);
  const [priceTouched, setPriceTouched] = useState(false);
  const [nextBillingDateTouched, setNextBillingDateTouched] = useState(false);
  const [trialEndDateTouched, setTrialEndDateTouched] = useState(false);

  const serviceNameError =
    serviceNameTouched && !serviceName.trim() ? 'Service name is required.' : null;
  const priceError = priceTouched && !price.trim() ? 'Price is required.' : null;
  const nextBillingDateError =
    nextBillingDateTouched && !nextBillingDate
      ? 'Next billing date is required.'
      : nextBillingDateTouched && nextBillingDate < minAllowedDate
        ? 'Next billing date cannot be before today.'
        : null;
  const trialEndDateError =
    trialEndDateTouched && trialEndDate && trialEndDate < minAllowedDate
      ? 'Trial end date cannot be before today.'
      : null;

  const filteredPresets = SERVICE_PRESETS.filter((p) =>
    p.name.toLowerCase().includes(presetFilter.toLowerCase()),
  );

  const filteredCategorySuggestions = existingCategories.filter((value) =>
    value.toLowerCase().includes(categoryFilter.toLowerCase()),
  );

  const selectPreset = (name: string, cat: SubscriptionCategory) => {
    setServiceName(name);
    setCategory(cat);
    setShowPresets(false);
    setPresetFilter('');
  };

  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = parseFloat(price);
    const trialEndDateBeforeToday = trialEndDate && trialEndDate < minAllowedDate;
    setServiceNameTouched(true);
    setPriceTouched(true);
    setNextBillingDateTouched(true);
    setTrialEndDateTouched(true);
    if (
      !serviceName.trim() ||
      isNaN(parsedPrice) ||
      !nextBillingDate ||
      nextBillingDate < minAllowedDate ||
      trialEndDateBeforeToday
    ) {
      return;
    }

    const base = {
      serviceName: serviceName.trim(),
      category,
      price: parsedPrice,
      currency: currency.trim() || 'USD',
      billingCycle,
      billingCycleCustomDays:
        billingCycle === 'custom' && customDays ? parseInt(customDays, 10) : undefined,
      nextBillingDate: dateInputToEpoch(nextBillingDate),
      trialEndDate: trialEndDate ? dateInputToEpoch(trialEndDate) : undefined,
      status,
      notes: notes.trim() || undefined,
      reminderDaysBefore: reminderDays,
    };

    if (isNew) {
      onSave({ ...base, userId: USER_ID } as SubscriptionCreate);
    } else {
      onSave(base as SubscriptionUpdate);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? 'New subscription' : 'Edit subscription'}
      onClick={handleBackdropClick}
    >
      <div
        className="modal-dialog sub-editor-modal"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-dialog__header">
          <span className="sub-editor-modal__title">
            {isNew ? 'New Subscription' : 'Edit Subscription'}
          </span>
          <button
            className="modal-dialog__close-btn"
            onClick={onClose}
            aria-label="Close editor"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <form className="sub-editor-modal__form" onSubmit={handleSubmit} noValidate>
          {/* Service name with preset autocomplete */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-serviceName">
              Service name
            </label>
            <div className="sub-editor-modal__autocomplete">
              <input
                id="sub-serviceName"
                className="sub-editor-modal__input"
                type="text"
                value={serviceName}
                onChange={(e) => {
                  setServiceName(e.target.value);
                  setPresetFilter(e.target.value);
                  setShowPresets(true);
                }}
                onFocus={() => {
                  setPresetFilter(serviceName);
                  setShowPresets(true);
                }}
                onBlur={() => {
                  setServiceNameTouched(true);
                  // Slight delay so mouseDown on preset item fires first
                  setTimeout(() => setShowPresets(false), 150);
                }}
                placeholder="e.g. Netflix, Spotify…"
                autoComplete="off"
                aria-invalid={Boolean(serviceNameError)}
                aria-describedby={serviceNameError ? 'sub-serviceName-error' : undefined}
                required
              />
              {serviceNameError && (
                <p id="sub-serviceName-error" className="sub-editor-modal__error" role="alert">
                  {serviceNameError}
                </p>
              )}
              {showPresets && filteredPresets.length > 0 && (
                <ul className="sub-editor-modal__presets" role="listbox">
                  {filteredPresets.slice(0, 8).map((p) => (
                    <li
                      key={p.name}
                      className="sub-editor-modal__preset-item"
                      role="option"
                      aria-selected={false}
                      onMouseDown={() => selectPreset(p.name, p.category)}
                    >
                      <span
                        className="sub-editor-modal__preset-dot"
                        style={{ background: p.defaultColor }}
                      />
                      {p.name}
                      <span className="sub-editor-modal__preset-cat">{p.category}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Category (autocomplete with optional free text) */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-category">
              Category
            </label>
            <div className="sub-editor-modal__autocomplete">
              <input
                id="sub-category"
                className="sub-editor-modal__input"
                type="text"
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setCategoryFilter(e.target.value);
                  setShowCategorySuggestions(true);
                }}
                onFocus={() => {
                  setCategoryFilter(category);
                  setShowCategorySuggestions(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowCategorySuggestions(false), 150);
                }}
                placeholder="e.g. streaming or custom"
                autoComplete="off"
              />
              {showCategorySuggestions && filteredCategorySuggestions.length > 0 && (
                <ul className="sub-editor-modal__presets" role="listbox">
                  {filteredCategorySuggestions.slice(0, 8).map((suggestion) => (
                    <li
                      key={suggestion}
                      className="sub-editor-modal__preset-item"
                      role="option"
                      aria-selected={category === suggestion}
                      onMouseDown={() => {
                        setCategory(suggestion);
                        setShowCategorySuggestions(false);
                      }}
                    >
                      {suggestion}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Price + currency */}
          <div>
            <div className="sub-editor-modal__row">
              <div className="sub-editor-modal__field sub-editor-modal__field--grow">
                <label className="sub-editor-modal__label" htmlFor="sub-price">
                  Price
                </label>
                <input
                  id="sub-price"
                  className="sub-editor-modal__input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onBlur={() => setPriceTouched(true)}
                  placeholder="9.99"
                  aria-invalid={Boolean(priceError)}
                  aria-describedby={priceError ? 'sub-price-error' : undefined}
                  required
                />
              </div>
              <div className="sub-editor-modal__field">
                <label className="sub-editor-modal__label" htmlFor="sub-currency">
                  Currency
                </label>
                <input
                  id="sub-currency"
                  className="sub-editor-modal__input sub-editor-modal__input--short"
                  type="text"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                />
              </div>
            </div>
            {priceError && (
              <p id="sub-price-error" className="sub-editor-modal__error" role="alert">
                {priceError}
              </p>
            )}
          </div>

          {/* Billing cycle */}
          <div className="sub-editor-modal__row">
            <div className="sub-editor-modal__field sub-editor-modal__field--grow">
              <label className="sub-editor-modal__label" htmlFor="sub-billingCycle">
                Billing cycle
              </label>
              <Select<SelectOption<BillingCycle>, false>
                inputId="sub-billingCycle"
                options={BILLING_CYCLE_OPTIONS}
                value={BILLING_CYCLE_OPTIONS.find((o) => o.value === billingCycle) ?? null}
                onChange={(selected: SingleValue<SelectOption<BillingCycle>>) => {
                  if (selected) setBillingCycle(selected.value);
                }}
                isSearchable={false}
                styles={SUB_SELECT_STYLES as StylesConfig<SelectOption<BillingCycle>, false>}
                menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
                menuPosition="fixed"
              />
            </div>
            {billingCycle === 'custom' && (
              <div className="sub-editor-modal__field">
                <label className="sub-editor-modal__label" htmlFor="sub-customDays">
                  Days
                </label>
                <input
                  id="sub-customDays"
                  className="sub-editor-modal__input sub-editor-modal__input--short"
                  type="number"
                  min="1"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  placeholder="30"
                />
              </div>
            )}
          </div>

          {/* Next billing date */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-nextBillingDate">
              Next billing date
            </label>
            <input
              id="sub-nextBillingDate"
              className="sub-editor-modal__input"
              type="date"
              min={minAllowedDate}
              value={nextBillingDate}
              onChange={(e) => setNextBillingDate(e.target.value)}
              onBlur={() => setNextBillingDateTouched(true)}
              aria-invalid={Boolean(nextBillingDateError)}
              aria-describedby={nextBillingDateError ? 'sub-nextBillingDate-error' : undefined}
              required
            />
            {nextBillingDateError && (
              <p id="sub-nextBillingDate-error" className="sub-editor-modal__error" role="alert">
                {nextBillingDateError}
              </p>
            )}
          </div>

          {/* Status */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-status">
              Status
            </label>
            <Select<SelectOption<SubscriptionStatus>, false>
              inputId="sub-status"
              options={STATUS_OPTIONS}
              value={STATUS_OPTIONS.find((o) => o.value === status) ?? null}
              onChange={(selected: SingleValue<SelectOption<SubscriptionStatus>>) => {
                if (selected) setStatus(selected.value);
              }}
              isSearchable={false}
              styles={SUB_SELECT_STYLES as StylesConfig<SelectOption<SubscriptionStatus>, false>}
              menuPortalTarget={typeof document === 'undefined' ? undefined : document.body}
              menuPosition="fixed"
            />
          </div>

          {/* Trial end date */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-trialEndDate">
              Trial end date <span className="sub-editor-modal__optional">(optional)</span>
            </label>
            <input
              id="sub-trialEndDate"
              className="sub-editor-modal__input"
              type="date"
              min={minAllowedDate}
              value={trialEndDate}
              onChange={(e) => setTrialEndDate(e.target.value)}
              onBlur={() => setTrialEndDateTouched(true)}
              aria-invalid={Boolean(trialEndDateError)}
              aria-describedby={trialEndDateError ? 'sub-trialEndDate-error' : undefined}
            />
            {trialEndDateError && (
              <p id="sub-trialEndDate-error" className="sub-editor-modal__error" role="alert">
                {trialEndDateError}
              </p>
            )}
          </div>

          {/* Reminder days */}
          <div className="sub-editor-modal__field">
            <span className="sub-editor-modal__label">Remind me before</span>
            <div className="sub-editor-modal__checkboxes">
              {REMINDER_OPTIONS.map((day) => (
                <label key={day} className="sub-editor-modal__checkbox-label">
                  <input
                    type="checkbox"
                    className="sub-editor-modal__checkbox"
                    checked={reminderDays.includes(day)}
                    onChange={() => toggleReminderDay(day)}
                  />
                  {day} {day === 1 ? 'day' : 'days'}
                </label>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="sub-editor-modal__field">
            <label className="sub-editor-modal__label" htmlFor="sub-notes">
              Notes <span className="sub-editor-modal__optional">(optional)</span>
            </label>
            <textarea
              id="sub-notes"
              className="sub-editor-modal__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any extra info…"
            />
          </div>

          <div className="sub-editor-modal__buttons">
            <button type="button" className="sub-editor-modal__cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="sub-editor-modal__save-btn">
              {isNew ? 'Add subscription' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
