import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  type BillingCycle,
  type Subscription,
  type SubscriptionCategory,
  type SubscriptionCreate,
  type SubscriptionStatus,
  type SubscriptionUpdate,
} from '../../../../../packages/shared/types/subscription';
import { USER_ID } from '../../subscriptions/service';
import { type Theme, useTheme } from '../../theme';

type SubscriptionEditorModalProps = {
  visible: boolean;
  subscription: Subscription | null;
  existingCategories: SubscriptionCategory[];
  saving: boolean;
  onClose: () => void;
  onSave: (data: SubscriptionCreate | SubscriptionUpdate) => Promise<void>;
};

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

const REMINDER_OPTIONS = [1, 3, 7] as const;

type DateField = 'nextBillingDate' | 'trialEndDate';

type TouchedState = {
  serviceName: boolean;
  price: boolean;
  customDays: boolean;
  nextBillingDate: boolean;
  trialEndDate: boolean;
};

const EMPTY_TOUCHED: TouchedState = {
  serviceName: false,
  price: false,
  customDays: false,
  nextBillingDate: false,
  trialEndDate: false,
};

function epochToDate(epoch?: number): Date | null {
  if (!epoch) return null;
  const next = new Date(epoch);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function formatDateLabel(date: Date | null): string {
  if (!date) return 'Select date';
  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeDate(date: Date): Date {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

export const SubscriptionEditorModal: React.FC<SubscriptionEditorModalProps> = ({
  visible,
  subscription,
  existingCategories,
  saving,
  onClose,
  onSave,
}) => {
  const { theme, resolvedMode } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isNew = subscription === null;
  const placeholderTextColor =
    resolvedMode === 'dark' ? 'rgba(248, 250, 252, 0.5)' : 'rgba(30, 41, 59, 0.45)';

  const [serviceName, setServiceName] = useState('');
  const [category, setCategory] = useState<SubscriptionCategory>('');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [customDays, setCustomDays] = useState('');
  const [nextBillingDate, setNextBillingDate] = useState<Date | null>(null);
  const [trialEndDate, setTrialEndDate] = useState<Date | null>(null);
  const [status, setStatus] = useState<SubscriptionStatus>('active');
  const [notes, setNotes] = useState('');
  const [reminderDays, setReminderDays] = useState<number[]>([3]);

  const [touched, setTouched] = useState<TouchedState>(EMPTY_TOUCHED);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const [activeDateField, setActiveDateField] = useState<DateField | null>(null);
  const [pickerDraftDate, setPickerDraftDate] = useState<Date>(startOfToday());
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  const today = useMemo(() => startOfToday(), []);

  useEffect(() => {
    if (!visible) return;
    setServiceName(subscription?.serviceName ?? '');
    setCategory(subscription?.category ?? '');
    setPrice(subscription?.price !== undefined ? String(subscription.price) : '');
    setCurrency(subscription?.currency ?? 'USD');
    setBillingCycle(subscription?.billingCycle ?? 'monthly');
    setCustomDays(
      subscription?.billingCycleCustomDays ? String(subscription.billingCycleCustomDays) : '',
    );
    setNextBillingDate(epochToDate(subscription?.nextBillingDate));
    setTrialEndDate(epochToDate(subscription?.trialEndDate));
    setStatus(subscription?.status ?? 'active');
    setNotes(subscription?.notes ?? '');
    setReminderDays(subscription?.reminderDaysBefore ?? [1, 3]);
    setTouched(EMPTY_TOUCHED);
    setSubmitAttempted(false);
    setActiveDateField(null);
    setShowCategorySuggestions(false);
    setPickerDraftDate(epochToDate(subscription?.nextBillingDate) ?? today);
  }, [subscription, today, visible]);

  const filteredCategorySuggestions = existingCategories.filter((value) =>
    value.toLowerCase().includes(category.toLowerCase()),
  );

  const parsedPrice = Number(price);
  const parsedCustomDays = Number.parseInt(customDays, 10);

  const serviceNameError =
    (submitAttempted || touched.serviceName) && !serviceName.trim()
      ? 'Service name is required.'
      : null;

  const priceError = null;

  const customDaysError =
    billingCycle === 'custom' &&
    (submitAttempted || touched.customDays) &&
    (!customDays.trim() || Number.isNaN(parsedCustomDays) || parsedCustomDays < 1)
      ? 'Custom cycle days must be at least 1.'
      : null;

  const nextBillingDateError =
    (submitAttempted || touched.nextBillingDate) &&
    (!nextBillingDate || normalizeDate(nextBillingDate).getTime() < today.getTime())
      ? 'Next billing date cannot be before today.'
      : null;

  const trialEndDateError =
    (submitAttempted || touched.trialEndDate) &&
    trialEndDate &&
    normalizeDate(trialEndDate).getTime() < today.getTime()
      ? 'Trial end date cannot be before today.'
      : null;

  const hasErrors = Boolean(
    serviceNameError || priceError || customDaysError || nextBillingDateError || trialEndDateError,
  );

  const applySelectedDate = (field: DateField, value: Date) => {
    const normalized = normalizeDate(value);
    if (field === 'nextBillingDate') {
      setNextBillingDate(normalized);
    } else {
      setTrialEndDate(normalized);
    }
  };

  const openDatePicker = (field: DateField) => {
    const fallbackDate =
      field === 'nextBillingDate'
        ? (nextBillingDate ?? today)
        : (trialEndDate ?? nextBillingDate ?? today);
    setPickerDraftDate(fallbackDate);
    setActiveDateField(field);
  };

  const handleAndroidDateChange = (event: DateTimePickerEvent, selected?: Date) => {
    const selectedField = activeDateField;
    setActiveDateField(null);

    if (event.type === 'dismissed' || !selectedField) {
      return;
    }
    if (selected) {
      const normalized = normalizeDate(selected);
      setPickerDraftDate(normalized);
      applySelectedDate(selectedField, normalized);
      setTouched((prev) => ({ ...prev, [selectedField]: true }));
    }
  };

  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) =>
      prev.includes(day) ? prev.filter((candidate) => candidate !== day) : [...prev, day],
    );
  };

  const handleSubmit = async () => {
    setSubmitAttempted(true);
    setTouched({
      serviceName: true,
      price: true,
      customDays: billingCycle === 'custom',
      nextBillingDate: true,
      trialEndDate: true,
    });

    const hasBlockingErrors =
      !serviceName.trim() ||
      (price.trim() && Number.isNaN(parsedPrice)) ||
      (billingCycle === 'custom' &&
        (!customDays.trim() || Number.isNaN(parsedCustomDays) || parsedCustomDays < 1)) ||
      !nextBillingDate ||
      normalizeDate(nextBillingDate).getTime() < today.getTime() ||
      (trialEndDate ? normalizeDate(trialEndDate).getTime() < today.getTime() : false);

    if (hasBlockingErrors || hasErrors || !nextBillingDate) return;

    const payload = {
      serviceName: serviceName.trim(),
      category,
      price: price.trim() ? parsedPrice : 0,
      currency: (currency.trim().toUpperCase() || 'USD').slice(0, 3),
      billingCycle,
      billingCycleCustomDays: billingCycle === 'custom' ? parsedCustomDays : undefined,
      nextBillingDate: normalizeDate(nextBillingDate).getTime(),
      trialEndDate: trialEndDate ? normalizeDate(trialEndDate).getTime() : undefined,
      status,
      notes: notes.trim() || undefined,
      reminderDaysBefore: [...reminderDays].sort((a, b) => a - b),
    };

    if (isNew) {
      await onSave({ ...payload, userId: USER_ID } as SubscriptionCreate);
      return;
    }

    await onSave(payload as SubscriptionUpdate);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} disabled={saving} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.header}>
              <Text style={styles.title}>{isNew ? 'New Subscription' : 'Edit Subscription'}</Text>
              <Pressable onPress={onClose} disabled={saving} hitSlop={8}>
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
            >
              <View style={styles.field}>
                <Text style={styles.label}>Service name</Text>
                <TextInput
                  value={serviceName}
                  onChangeText={setServiceName}
                  onBlur={() => setTouched((prev) => ({ ...prev, serviceName: true }))}
                  placeholder="e.g. Netflix"
                  placeholderTextColor={placeholderTextColor}
                  style={styles.input}
                />
                {serviceNameError && <Text style={styles.error}>{serviceNameError}</Text>}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <View style={styles.autocompleteWrap}>
                  <TextInput
                    value={category}
                    onChangeText={(value) => {
                      setCategory(value);
                      setShowCategorySuggestions(true);
                    }}
                    onFocus={() => setShowCategorySuggestions(true)}
                    onBlur={() => {
                      setTimeout(() => setShowCategorySuggestions(false), 120);
                    }}
                    placeholder="e.g. streaming or custom"
                    placeholderTextColor={placeholderTextColor}
                    style={styles.input}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />

                  {showCategorySuggestions && filteredCategorySuggestions.length > 0 && (
                    <View style={styles.autocompleteMenu}>
                      <ScrollView
                        style={styles.selectMenuScroll}
                        nestedScrollEnabled
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator
                      >
                        {filteredCategorySuggestions.slice(0, 8).map((option) => (
                          <Pressable
                            key={option}
                            style={styles.autocompleteOption}
                            onPress={() => {
                              setCategory(option);
                              setShowCategorySuggestions(false);
                            }}
                          >
                            <Text style={styles.autocompleteOptionText}>{option}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.field, styles.rowGrow]}>
                  <Text style={styles.label}>Price</Text>
                  <TextInput
                    value={price}
                    onChangeText={setPrice}
                    onBlur={() => setTouched((prev) => ({ ...prev, price: true }))}
                    placeholder="9.99"
                    placeholderTextColor={placeholderTextColor}
                    style={styles.input}
                    keyboardType="decimal-pad"
                  />
                  {priceError && <Text style={styles.error}>{priceError}</Text>}
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Currency</Text>
                  <TextInput
                    value={currency}
                    onChangeText={(value) => setCurrency(value.toUpperCase())}
                    placeholder="USD"
                    placeholderTextColor={placeholderTextColor}
                    style={styles.inputSmall}
                    maxLength={3}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Billing cycle</Text>
                <View style={styles.chipWrap}>
                  {BILLING_CYCLE_OPTIONS.map((option) => {
                    const selected = billingCycle === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setBillingCycle(option.value)}
                      >
                        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {billingCycle === 'custom' && (
                <View style={styles.field}>
                  <Text style={styles.label}>Custom cycle days</Text>
                  <TextInput
                    value={customDays}
                    onChangeText={setCustomDays}
                    onBlur={() => setTouched((prev) => ({ ...prev, customDays: true }))}
                    placeholder="30"
                    placeholderTextColor={placeholderTextColor}
                    style={styles.input}
                    keyboardType="number-pad"
                  />
                  {customDaysError && <Text style={styles.error}>{customDaysError}</Text>}
                </View>
              )}

              <View style={styles.field}>
                <Text style={styles.label}>Next billing date</Text>
                <Pressable
                  style={styles.dateButton}
                  onPress={() => openDatePicker('nextBillingDate')}
                >
                  <Ionicons name="calendar-outline" size={16} color={theme.colors.primary} />
                  <Text style={styles.dateButtonText}>{formatDateLabel(nextBillingDate)}</Text>
                </Pressable>
                {nextBillingDateError && <Text style={styles.error}>{nextBillingDateError}</Text>}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Status</Text>
                <View style={styles.chipWrap}>
                  {STATUS_OPTIONS.map((option) => {
                    const selected = status === option.value;
                    return (
                      <Pressable
                        key={option.value}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => setStatus(option.value)}
                      >
                        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Trial end date (optional)</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.dateButton, styles.rowGrow]}
                    onPress={() => openDatePicker('trialEndDate')}
                  >
                    <Ionicons name="calendar-outline" size={16} color={theme.colors.primary} />
                    <Text style={styles.dateButtonText}>{formatDateLabel(trialEndDate)}</Text>
                  </Pressable>
                  {trialEndDate && (
                    <Pressable
                      style={styles.clearDateButton}
                      onPress={() => {
                        setTrialEndDate(null);
                        setTouched((prev) => ({ ...prev, trialEndDate: true }));
                      }}
                    >
                      <Ionicons name="close" size={16} color={theme.colors.textMuted} />
                    </Pressable>
                  )}
                </View>
                {trialEndDateError && <Text style={styles.error}>{trialEndDateError}</Text>}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Remind me before</Text>
                <View style={styles.chipWrap}>
                  {REMINDER_OPTIONS.map((day) => {
                    const selected = reminderDays.includes(day);
                    return (
                      <Pressable
                        key={day}
                        style={[styles.chip, selected && styles.chipSelected]}
                        onPress={() => toggleReminderDay(day)}
                      >
                        <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                          {day} {day === 1 ? 'day' : 'days'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Notes (optional)</Text>
                <TextInput
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Any extra info"
                  placeholderTextColor={placeholderTextColor}
                  style={styles.textarea}
                  multiline
                  textAlignVertical="top"
                />
              </View>

              {Platform.OS === 'ios' && activeDateField && (
                <View style={styles.iosPickerCard}>
                  <DateTimePicker
                    value={pickerDraftDate}
                    mode="date"
                    display="spinner"
                    onChange={(_, selected) => {
                      if (selected) {
                        setPickerDraftDate(selected);
                      }
                    }}
                    minimumDate={today}
                    themeVariant={resolvedMode}
                  />
                  <View style={styles.iosPickerActions}>
                    <Pressable
                      style={styles.secondaryButton}
                      onPress={() => setActiveDateField(null)}
                      disabled={saving}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      style={styles.primaryButton}
                      onPress={() => {
                        if (!activeDateField) return;
                        applySelectedDate(activeDateField, pickerDraftDate);
                        setTouched((prev) => ({ ...prev, [activeDateField]: true }));
                        setActiveDateField(null);
                      }}
                      disabled={saving}
                    >
                      <Text style={styles.primaryButtonText}>Done</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.footer}>
              <Pressable style={styles.secondaryButton} onPress={onClose} disabled={saving}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleSubmit} disabled={saving}>
                {saving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isNew ? 'Add subscription' : 'Save changes'}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>

      {Platform.OS === 'android' && activeDateField && (
        <DateTimePicker
          value={pickerDraftDate}
          mode="date"
          display="default"
          onChange={handleAndroidDateChange}
          minimumDate={today}
          themeVariant={resolvedMode}
        />
      )}
    </Modal>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
    },
    sheetWrap: {
      width: '100%',
      height: '100%',
    },
    sheet: {
      flex: 1,
      borderTopLeftRadius: 0,
      borderTopRightRadius: 0,
      backgroundColor: theme.colors.surface,
      borderWidth: 0,
      paddingHorizontal: theme.spacing.md,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 42,
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.border,
      marginBottom: 4,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    title: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.lg,
      fontWeight: theme.typography.weights.bold as '700',
      fontFamily: theme.typography.fontFamily,
      flex: 1,
    },
    content: {
      gap: theme.spacing.md,
      paddingBottom: theme.spacing.lg,
    },
    formScroll: {
      flex: 1,
    },
    field: {
      gap: 6,
    },
    label: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.semibold as '600',
      fontFamily: theme.typography.fontFamily,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    rowGrow: {
      flex: 1,
    },
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      fontSize: theme.typography.sizes.base,
      fontFamily: theme.typography.fontFamily,
    },
    inputSmall: {
      width: 88,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      fontSize: theme.typography.sizes.base,
      fontFamily: theme.typography.fontFamily,
      textAlign: 'center',
    },
    autocompleteWrap: {
      position: 'relative',
      zIndex: 40,
    },
    autocompleteMenu: {
      position: 'absolute',
      top: 48,
      left: 0,
      right: 0,
      zIndex: 50,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface,
      overflow: 'hidden',
      ...theme.shadows.md,
    },
    selectMenuScroll: {
      maxHeight: 220,
    },
    autocompleteOption: {
      minHeight: 42,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 10,
      justifyContent: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    autocompleteOptionText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      fontFamily: theme.typography.fontFamily,
    },
    textarea: {
      minHeight: 92,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.background,
      color: theme.colors.text,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      fontSize: theme.typography.sizes.base,
      fontFamily: theme.typography.fontFamily,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: `${theme.colors.primary}20`,
    },
    chipLabel: {
      color: theme.colors.textMuted,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.medium as '500',
      fontFamily: theme.typography.fontFamily,
    },
    chipLabelSelected: {
      color: theme.colors.primary,
    },
    dateButton: {
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.background,
      minHeight: 42,
      paddingHorizontal: theme.spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    dateButtonText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.base,
      fontFamily: theme.typography.fontFamily,
    },
    clearDateButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    error: {
      color: theme.colors.error,
      fontSize: theme.typography.sizes.xs,
      fontFamily: theme.typography.fontFamily,
    },
    iosPickerCard: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.lg,
      backgroundColor: theme.colors.background,
      paddingVertical: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      gap: theme.spacing.xs,
    },
    iosPickerActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      paddingBottom: theme.spacing.xs,
      borderTopWidth: 1,
      borderTopColor: theme.colors.border,
    },
    secondaryButton: {
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    },
    secondaryButtonText: {
      color: theme.colors.text,
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.semibold as '600',
      fontFamily: theme.typography.fontFamily,
    },
    primaryButton: {
      borderRadius: theme.borderRadius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 40,
      minWidth: 130,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.primary,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontSize: theme.typography.sizes.sm,
      fontWeight: theme.typography.weights.semibold as '600',
      fontFamily: theme.typography.fontFamily,
    },
  });
