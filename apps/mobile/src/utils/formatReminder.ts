import { RepeatRule } from '../../../../packages/shared/types/reminder';

export const formatReminder = (date: Date, repeatRule: RepeatRule | null) => {
  const timeStr = date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  if (repeatRule) {
    let ruleLabel: string;
    if (repeatRule.kind === 'daily' && repeatRule.interval > 1) {
      ruleLabel = `Every ${repeatRule.interval} days`;
    } else if (repeatRule.kind === 'custom') {
      const unit = repeatRule.frequency === 'minutes' ? 'min' : repeatRule.frequency;
      ruleLabel = `Every ${repeatRule.interval} ${unit}`;
    } else {
      ruleLabel = repeatRule.kind.charAt(0).toUpperCase() + repeatRule.kind.slice(1);
    }
    return `${timeStr} (${ruleLabel})`;
  }
  return timeStr;
};
