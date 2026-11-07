import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

export function RecentPaymentsAccordion({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[10px] uppercase font-semibold text-[var(--w-text-muted)] tracking-wide hover:text-[var(--w-text)] transition-colors">
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </button>
      {open && (
        <div className="mt-1.5 max-h-[160px] overflow-y-auto">
          {children}
        </div>
      )}
    </div>
  );
}
