import type { ReactNode, ElementType } from 'react';

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: ElementType; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center text-[var(--w-text)] sm:py-8">
      <div className="flex items-center justify-center gap-2">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--w-text-sec)]" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {description && <p className="mt-1 max-w-sm text-sm text-[var(--w-text-sec)]">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
