/**
 * Note Background Color Presets
 * Each preset has light and dark theme variants with 0.2-0.25 alpha for readability
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
    lightColor: '', // Will use theme.colors.surface
    darkColor: '', // Will use theme.colors.surface
  },
  {
    id: 'red',
    name: 'Red',
    lightColor: '#ff9292', // red-500 solid
    darkColor: '#952222', // red-600 solid
  },
  {
    id: 'yellow',
    name: 'Yellow',
    lightColor: '#ffdd77', // yellow-500 solid
    darkColor: '#936c18', // yellow-600 solid
  },
  {
    id: 'green',
    name: 'Green',
    lightColor: '#76faa7', // green-500 solid
    darkColor: '#196836', // green-600 solid
  },
  {
    id: 'blue',
    name: 'Blue',
    lightColor: '#82b2ff', // blue-500 solid (primary color)
    darkColor: '#28478b', // blue-600 solid
  },
  {
    id: 'purple',
    name: 'Purple',
    lightColor: '#cb93ff', // purple-500 solid
    darkColor: '#5f2d8d', // purple-600 solid
  },
];

/**
 * Resolve a preset ID to the appropriate background color for the current theme.
 * Returns empty string for 'default' or unknown IDs (caller uses theme surface).
 * Also handles legacy hex/rgba values by matching them back to a preset.
 */
export function resolveNoteColor(presetId: string | null | undefined, isDark: boolean): string {
  if (!presetId || presetId === 'default') return '';

  // Direct preset ID lookup
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
  // Preset ID that is not 'default'
  if (NOTE_COLOR_PRESETS.some((p) => p.id === color && color !== 'default')) return true;
  // Legacy hex/rgba value that matches a non-default preset
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

  // Already a known preset ID?
  if (NOTE_COLOR_PRESETS.some((p) => p.id === color)) return color;

  // Legacy hex/rgba → find matching preset
  for (const p of NOTE_COLOR_PRESETS) {
    if (p.lightColor === color || p.darkColor === color) return p.id;
  }

  return 'default';
}
