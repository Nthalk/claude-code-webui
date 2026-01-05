import { useState, useEffect } from 'react';

/**
 * Hook to detect virtual keyboard height on mobile devices.
 * Uses the visualViewport API to detect when the keyboard opens/closes.
 * Returns the keyboard height in pixels (0 when closed).
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    // Store initial viewport height (without keyboard)
    let initialHeight = viewport.height;

    const handleResize = () => {
      // Keyboard height = difference between initial height and current viewport height
      const currentHeight = viewport.height;
      const heightDiff = initialHeight - currentHeight;

      // Only consider it a keyboard if the difference is significant (> 100px)
      // This filters out minor viewport changes from address bar hiding, etc.
      if (heightDiff > 100) {
        setKeyboardHeight(heightDiff);
      } else {
        setKeyboardHeight(0);
        // Update initial height when keyboard is closed (in case orientation changed)
        initialHeight = currentHeight;
      }
    };

    viewport.addEventListener('resize', handleResize);

    return () => {
      viewport.removeEventListener('resize', handleResize);
    };
  }, []);

  return keyboardHeight;
}
