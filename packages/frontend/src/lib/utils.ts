import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strips the working directory prefix from a file path to make it relative.
 * If the path doesn't start with the working directory, returns the original path.
 * @param filePath The absolute file path
 * @param workingDirectory The working directory to strip from the path
 * @returns The relative path or original path if not a child of working directory
 */
export function stripWorkingDirectory(filePath: string, workingDirectory?: string): string {
  if (!workingDirectory || !filePath) {
    return filePath;
  }

  // Normalize paths to handle trailing slashes consistently
  const normalizedWorkingDir = workingDirectory.endsWith('/')
    ? workingDirectory.slice(0, -1)
    : workingDirectory;

  // Check if the file path starts with the working directory
  if (filePath.startsWith(normalizedWorkingDir + '/')) {
    // Return the path without the working directory prefix
    return filePath.slice(normalizedWorkingDir.length + 1);
  } else if (filePath === normalizedWorkingDir) {
    // If the path is exactly the working directory, return '.'
    return '.';
  }

  // Return original path if it's not under the working directory
  return filePath;
}

/**
 * Detects if the current platform is macOS
 * @returns true if running on macOS, false otherwise
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toLowerCase().includes('mac') ||
         navigator.userAgent.toLowerCase().includes('mac');
}

/**
 * Gets the platform-appropriate modifier key name
 * @returns 'Cmd' for macOS, 'Ctrl' for other platforms
 */
export function getModifierKey(): string {
  return isMac() ? 'Cmd' : 'Ctrl';
}

/**
 * Formats a keyboard shortcut with the correct modifier key for the platform
 * @param key The key to combine with the modifier (e.g., 'S', 'C', 'V')
 * @returns The formatted shortcut string (e.g., 'Cmd+S' on Mac, 'Ctrl+S' on Windows/Linux)
 */
export function formatShortcut(key: string): string {
  return `${getModifierKey()}+${key}`;
}
