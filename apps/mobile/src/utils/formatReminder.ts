import { RepeatRule } from '../../../../packages/shared/types/reminder';
import { formatReminderLabel } from '../../../../packages/shared/utils/repeatLabel';

export const formatReminder = (date: Date, repeatRule: RepeatRule | null): string => {
  return formatReminderLabel(date, repeatRule, {
    separator: ' ',
    wrapParens: true,
    dateFormatOptions: {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  });
};
