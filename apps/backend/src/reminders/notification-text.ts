type NotificationTextSource = Readonly<{
  title?: string | null;
  content?: string | null;
  contentType?: string | null;
}>;

const trimOrEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const checklistToPlainText = (rawContent: string): string => {
  try {
    const parsed = JSON.parse(rawContent);
    if (!Array.isArray(parsed)) {
      return '';
    }

    return parsed
      .filter(
        (item): item is Readonly<{ text: string; checked: boolean }> =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { text?: unknown }).text === 'string' &&
          typeof (item as { checked?: unknown }).checked === 'boolean',
      )
      .map((item) => `${item.checked ? '✓' : '☐'} ${item.text}`)
      .join('\n');
  } catch {
    return '';
  }
};

export const renderReminderNotificationText = (
  source: NotificationTextSource,
): Readonly<{ title: string; body: string }> => {
  const titleText = trimOrEmpty(source.title);
  const rawContent = trimOrEmpty(source.content);
  const contentText =
    source.contentType === 'checklist' && rawContent.length > 0
      ? checklistToPlainText(rawContent)
      : rawContent;

  if (titleText && contentText) {
    return { title: titleText, body: contentText };
  }

  if (titleText) {
    return { title: titleText, body: '' };
  }

  if (contentText) {
    return { title: contentText, body: '' };
  }

  return { title: 'Reminder', body: 'You have a reminder' };
};
