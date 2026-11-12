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

/** "Sajid Rahman" → "SR", "rahim" → "R" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '?';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}
