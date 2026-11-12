import { isPaletteColor, type PaletteColor } from '@teamboard/shared';

// Full class names written out so Tailwind can find them (it can't see `bg-${color}-500`).
export const AVATAR_BG: Record<PaletteColor, string> = {
  gray: 'bg-gray-500',
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-600',
  teal: 'bg-teal-500',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  purple: 'bg-purple-500',
  pink: 'bg-pink-500',
};

export const avatarBg = (color: string) => AVATAR_BG[isPaletteColor(color) ? color : 'blue'];

/** Label chips: a soft background with readable text, in light and dark mode. */
export const LABEL_CHIP: Record<PaletteColor, string> = {
  gray: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
  red: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  green: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
};

/** The small dot in front of a label name in pickers. */
export const LABEL_DOT: Record<PaletteColor, string> = AVATAR_BG;

/** "Sajid Rahman" → "SR", "rahim" → "R" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
