import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind class names so a caller's override always wins:
 *   cn('px-4 py-2', 'py-3') → 'px-4 py-3'
 *
 * Both packages were already dependencies; this is the one place they are wired together.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
