/**
 * Note Background Color Presets
 * Each preset has light and dark theme variants.
 */

export type NoteColorPreset = {
  id: string;
  name: string;
  lightColor: string;
  darkColor: string;
};

export const NOTE_COLOR_PRESETS: NoteColorPreset[] = [
  {
    id: 'default',
    name: 'Default',
    lightColor: '', // Will use theme surface color
    darkColor: '', // Will use theme surface color
  },
  {
    id: 'red',
    name: 'Red',
    lightColor: '#ff9292',
    darkColor: '#952222',
  },
  {
    id: 'yellow',
    name: 'Yellow',
    lightColor: '#ffdd77',
    darkColor: '#936c18',
  },
  {
    id: 'green',
    name: 'Green',
    lightColor: '#76faa7',
    darkColor: '#196836',
  },
  {
    id: 'blue',
    name: 'Blue',
    lightColor: '#82b2ff',
    darkColor: '#28478b',
  },
  {
    id: 'purple',
    name: 'Purple',
    lightColor: '#cb93ff',
    darkColor: '#5f2d8d',
  },
];

/**
 * Resolve a preset ID to the appropriate background color for the current theme.
 * Returns empty string for 'default' or unknown IDs (caller uses theme surface).
 * Also handles legacy hex/rgba values by matching them back to a preset.
 */
export function resolveNoteColor(presetId: string | null | undefined, isDark: boolean): string {
  if (!presetId || presetId === 'default') return '';

  const preset = NOTE_COLOR_PRESETS.find((p) => p.id === presetId);
  if (preset) {
    return isDark ? preset.darkColor : preset.lightColor;
  }

  // Legacy: value is a hex/rgba string from older saves – try to map back
  for (const p of NOTE_COLOR_PRESETS) {
    if (p.lightColor === presetId || p.darkColor === presetId) {
      return isDark ? p.darkColor : p.lightColor;
    }
  }

  return '';
}

/**
 * Check whether a stored color value represents a non-default custom colour.
 * Works with both preset IDs and legacy hex strings.
 */
export function hasCustomColor(color: string | null | undefined): boolean {
  if (!color || color === '' || color === 'default') return false;
  if (NOTE_COLOR_PRESETS.some((p) => p.id === color && color !== 'default')) return true;
  return NOTE_COLOR_PRESETS.some(
    (p) => p.id !== 'default' && (p.lightColor === color || p.darkColor === color),
  );
}

/**
 * Normalise a stored color value to a preset ID.
 * Handles preset IDs, legacy hex/rgba strings, and null.
 */
export function toPresetId(color: string | null | undefined): string {
  if (!color || color === 'default') return 'default';

  if (NOTE_COLOR_PRESETS.some((p) => p.id === color)) return color;

  for (const p of NOTE_COLOR_PRESETS) {
    if (p.lightColor === color || p.darkColor === color) return p.id;
  }

  return 'default';
}
