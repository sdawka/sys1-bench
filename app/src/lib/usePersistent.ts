import { useEffect, useRef, useState } from 'react';
import { load, save } from './storage';

/** useState mirrored to localStorage (writes debounced so rapid run updates stay cheap; flushed on page hide). */
export function usePersistent<T>(key: string, initial: T, onSaveFail?: () => void) {
  const [value, setValue] = useState<T>(() => load(key, initial));
  const timer = useRef<number>();
  const pending = useRef<{ v: T } | null>(null);
  useEffect(() => {
    window.clearTimeout(timer.current);
    pending.current = { v: value };
    timer.current = window.setTimeout(() => {
      pending.current = null;
      if (!save(key, value)) onSaveFail?.();
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [key, value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const flush = () => {
      if (pending.current) {
        save(key, pending.current.v);
        pending.current = null;
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, [key]);
  return [value, setValue] as const;
}
