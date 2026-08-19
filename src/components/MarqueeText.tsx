import { useRef, useState, useEffect, type ReactNode } from 'react';

export function MarqueeText({ children, className }: { children: ReactNode; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useEffect(() => {
    const check = () => {
      const c = containerRef.current;
      const el = contentRef.current;
      if (!c || !el) return;
      const overflow = el.scrollWidth - c.clientWidth;
      setShift(overflow > 1 ? overflow : 0);
    };
    check();
    const ro = new ResizeObserver(check);
    if (containerRef.current) ro.observe(containerRef.current);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={containerRef} className="marquee-container">
      <span
        ref={contentRef}
        className={`marquee-inner ${className ?? ''}`}
        style={{ '--marquee-shift': `${-shift}px` } as React.CSSProperties}
        data-overflowing={shift > 0}
      >
        {children}
      </span>
    </div>
  );
}
