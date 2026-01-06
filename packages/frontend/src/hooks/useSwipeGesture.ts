import { useEffect, useRef, useCallback } from 'react';

interface SwipeConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onSwipeProgress?: (direction: 'left' | 'right' | null, progress: number) => void;
  threshold?: number; // Minimum distance in pixels
  velocityThreshold?: number; // Minimum velocity in px/ms
  enabled?: boolean;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
  currentX: number;
  currentY: number;
}

export function useSwipeGesture<T extends HTMLElement = HTMLElement>(
  config: SwipeConfig
) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    threshold = 50,
    velocityThreshold = 0.3,
    enabled = true,
  } = config;

  const touchState = useRef<TouchState | null>(null);
  const elementRef = useRef<T>(null);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;

      const touch = e.touches[0];
      if (!touch) return;

      // Check if the target or any parent element is horizontally scrollable
      const target = e.target as HTMLElement;
      let element: HTMLElement | null = target;
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        const overflowX = style.overflowX;
        const scrollWidth = element.scrollWidth;
        const clientWidth = element.clientWidth;

        // Check for commonly scrollable elements
        const isScrollableElement = element.tagName === 'PRE' ||
                                   element.tagName === 'CODE' ||
                                   element.tagName === 'TABLE';

        // Element is horizontally scrollable if:
        // 1. overflow-x is auto or scroll AND
        // 2. scrollWidth > clientWidth (content actually overflows)
        // 3. There's a meaningful overflow (more than just rounding errors)
        const hasHorizontalOverflow = scrollWidth > clientWidth + 1; // +1 for rounding tolerance

        if ((overflowX === 'auto' || overflowX === 'scroll') && hasHorizontalOverflow) {
          return; // Don't track swipes on horizontally scrollable elements
        }

        // Check for elements that are actively scrolled
        if (element.scrollLeft > 0) {
          return; // Element has been scrolled, so it's scrollable
        }

        // Special handling for commonly scrollable elements that actually have overflow
        if (isScrollableElement && hasHorizontalOverflow) {
          return;
        }

        element = element.parentElement;
      }

      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
    },
    [enabled]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!enabled || !touchState.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchState.current.currentX = touch.clientX;
      touchState.current.currentY = touch.clientY;
    },
    [enabled]
  );

  const handleTouchEnd = useCallback(() => {
    if (!enabled || !touchState.current) return;

    const { startX, startY, startTime, currentX, currentY } = touchState.current;
    const deltaX = currentX - startX;
    const deltaY = currentY - startY;
    const deltaTime = Date.now() - startTime;

    // Calculate velocity
    const velocityX = Math.abs(deltaX) / deltaTime;
    const velocityY = Math.abs(deltaY) / deltaTime;

    // Determine swipe direction
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);

    if (isHorizontal) {
      // Horizontal swipe
      if (
        Math.abs(deltaX) >= threshold &&
        velocityX >= velocityThreshold
      ) {
        if (deltaX > 0) {
          onSwipeRight?.();
        } else {
          onSwipeLeft?.();
        }
      }
    } else {
      // Vertical swipe
      if (
        Math.abs(deltaY) >= threshold &&
        velocityY >= velocityThreshold
      ) {
        if (deltaY > 0) {
          onSwipeDown?.();
        } else {
          onSwipeUp?.();
        }
      }
    }

    touchState.current = null;
  }, [enabled, threshold, velocityThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !enabled) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return elementRef;
}

// Hook variant that attaches to the document for global gestures
export function useDocumentSwipeGesture(config: SwipeConfig) {
  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onSwipeProgress,
    threshold = 50,
    velocityThreshold = 0.3,
    enabled = true,
  } = config;

  const touchState = useRef<TouchState | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;

      // Don't track swipes on interactive elements
      const target = e.target as HTMLElement;
      const isInteractive = target.tagName === 'INPUT' ||
                          target.tagName === 'TEXTAREA' ||
                          target.tagName === 'BUTTON' ||
                          target.tagName === 'A' ||
                          target.getAttribute('contenteditable') === 'true';

      if (isInteractive) return;

      // Check if the target or any parent element is horizontally scrollable
      let element: HTMLElement | null = target;
      while (element && element !== document.body) {
        const style = window.getComputedStyle(element);
        const overflowX = style.overflowX;
        const scrollWidth = element.scrollWidth;
        const clientWidth = element.clientWidth;

        // Check for commonly scrollable elements
        const isScrollableElement = element.tagName === 'PRE' ||
                                   element.tagName === 'CODE' ||
                                   element.tagName === 'TABLE';

        // Element is horizontally scrollable if:
        // 1. overflow-x is auto or scroll AND
        // 2. scrollWidth > clientWidth (content actually overflows)
        // 3. There's a meaningful overflow (more than just rounding errors)
        const hasHorizontalOverflow = scrollWidth > clientWidth + 1; // +1 for rounding tolerance

        if ((overflowX === 'auto' || overflowX === 'scroll') && hasHorizontalOverflow) {
          return; // Don't track swipes on horizontally scrollable elements
        }

        // Check for elements that are actively scrolled
        if (element.scrollLeft > 0) {
          return; // Element has been scrolled, so it's scrollable
        }

        // Special handling for commonly scrollable elements that actually have overflow
        if (isScrollableElement && hasHorizontalOverflow) {
          return;
        }

        element = element.parentElement;
      }

      touchState.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        currentX: touch.clientX,
        currentY: touch.clientY,
      };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchState.current) return;

      const touch = e.touches[0];
      if (!touch) return;

      touchState.current.currentX = touch.clientX;
      touchState.current.currentY = touch.clientY;

      // Calculate swipe progress
      if (onSwipeProgress) {
        const deltaX = touchState.current.currentX - touchState.current.startX;
        const deltaY = touchState.current.currentY - touchState.current.startY;

        // Only track horizontal swipes
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          const progress = Math.min(Math.abs(deltaX) / threshold, 1);
          const direction = deltaX > 0 ? 'right' : 'left';
          onSwipeProgress(direction, progress);
        } else {
          onSwipeProgress(null, 0);
        }
      }
    };

    const handleTouchEnd = () => {
      if (!touchState.current) return;

      const { startX, startY, startTime, currentX, currentY } = touchState.current;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      const deltaTime = Date.now() - startTime;

      const velocityX = Math.abs(deltaX) / deltaTime;

      // Only handle horizontal swipes
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) >= threshold && velocityX >= velocityThreshold) {
          if (deltaX > 0) {
            onSwipeRight?.();
          } else {
            onSwipeLeft?.();
          }
        }
      }

      // Reset progress
      if (onSwipeProgress) {
        onSwipeProgress(null, 0);
      }

      touchState.current = null;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [enabled, threshold, velocityThreshold, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown, onSwipeProgress]);
}
