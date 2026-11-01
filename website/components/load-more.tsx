'use client';
import { useEffect, useRef } from 'react';

/**
 * Reveals the next slice of a long list as the reader nears its end, so a list
 * simply keeps going instead of stopping at a "show more" button.
 *
 * Lists still render in slices: the team directory holds tens of thousands of
 * teams, and mounting every card at once would stall the page. `count` is the
 * number already shown; observing again whenever it changes matters, because
 * an observer only reports changes - on a tall screen the marker can still be
 * in view after a slice is added, and without a fresh observation the list
 * would stop there.
 */
export default function LoadMore({ count, onReach }: { count: number; onReach: () => void }) {
  const marker = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onReach);
  latest.current = onReach;
  useEffect(() => {
    const node = marker.current;
    if (!node) return;
    // Start well before the end, so a reader scrolling steadily never sees it.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) latest.current();
    }, { rootMargin: '1200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);
  return <div ref={marker} aria-hidden="true" className="h-px" />;
}
