'use client';
/**
 * Loads Paka on desktop only: a wide window and a mouse. Phones and tablets
 * never download the widget, and desktops fetch it after the page is idle so
 * it cannot slow the first view.
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import type { PakaProps } from './Paka';

const Paka = lazy(() => import('./Paka'));
export const DESKTOP_QUERY = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

export default function PakaLoader(props: PakaProps) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.(DESKTOP_QUERY);
    if (!query) return;
    let handle = 0;
    const start = () => {
      if (!query.matches) { setReady(false); return; }
      const idle = (window as any).requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 1200));
      handle = idle(() => setReady(true));
    };
    start();
    // Resizing below the breakpoint tucks Paka away; growing back brings it out.
    query.addEventListener('change', start);
    return () => {
      query.removeEventListener('change', start);
      (window as any).cancelIdleCallback?.(handle);
      window.clearTimeout(handle);
    };
  }, []);
  if (!ready) return null;
  return <Suspense fallback={null}><Paka {...props} /></Suspense>;
}
