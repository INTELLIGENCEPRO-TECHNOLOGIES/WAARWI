import { ReactNode, ElementType } from 'react';

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: ElementType; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
      <Icon className="w-8 h-8 text-slate-300 mb-4" />
      <h3 className="text-base font-semibold text-slate-900 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-500 max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  );
}
