import { useEffect, useState } from 'react';

export function useStickyOffset<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!el) return;
    const update = () => setHeight(el.getBoundingClientRect().height);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [setEl, height] as const;
}
