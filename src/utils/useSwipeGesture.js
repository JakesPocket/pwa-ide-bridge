import { useRef, useEffect } from 'react';

/**
 * Custom hook to detect swipe gestures for tab navigation
 * @param {Function} onSwipeLeft - Callback when swiping left (next tab)
 * @param {Function} onSwipeRight - Callback when swiping right (previous tab)
 * @param {Object} options - Configuration options
 * @returns {Object} - Ref to attach to the swipeable element
 */
export function useSwipeGesture(
  onSwipeLeft,
  onSwipeRight,
  options = {}
) {
  const {
    minSwipeDistance = 50,
    maxVerticalDistance = 100,
    preventDefaultTouch = false,
  } = options;

  const touchStartRef = useRef(null);
  const touchEndRef = useRef(null);
  const elementRef = useRef(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const handleTouchStart = (e) => {
      touchEndRef.current = null;
      touchStartRef.current = {
        x: e.targetTouches[0].clientX,
        y: e.targetTouches[0].clientY,
      };
    };

    const handleTouchMove = (e) => {
      touchEndRef.current = {
        x: e.targetTouches[0].clientX,
        y: e.targetTouches[0].clientY,
      };

      // Optionally prevent default scrolling during swipe
      if (preventDefaultTouch) {
        const start = touchStartRef.current;
        const end = touchEndRef.current;
        if (start && end) {
          const deltaX = Math.abs(end.x - start.x);
          const deltaY = Math.abs(end.y - start.y);
          // If horizontal swipe is dominant, prevent default
          if (deltaX > deltaY && deltaX > 10) {
            e.preventDefault();
          }
        }
      }
    };

    const handleTouchEnd = () => {
      if (!touchStartRef.current || !touchEndRef.current) return;

      const deltaX = touchStartRef.current.x - touchEndRef.current.x;
      const deltaY = touchStartRef.current.y - touchEndRef.current.y;
      const absX = Math.abs(deltaX);
      const absY = Math.abs(deltaY);

      // Check if it's a horizontal swipe (not vertical scroll)
      if (absX < minSwipeDistance) return;
      if (absY > maxVerticalDistance) return;
      if (absX < absY) return; // Vertical movement is larger

      // Determine swipe direction
      if (deltaX > 0) {
        // Swiped left (next tab)
        onSwipeLeft?.();
      } else {
        // Swiped right (previous tab)
        onSwipeRight?.();
      }

      // Reset
      touchStartRef.current = null;
      touchEndRef.current = null;
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: !preventDefaultTouch });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onSwipeLeft, onSwipeRight, minSwipeDistance, maxVerticalDistance, preventDefaultTouch]);

  return elementRef;
}
