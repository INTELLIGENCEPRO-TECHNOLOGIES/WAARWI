import { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string };
type ToastCtx = {
  toast: (msg: string, kind?: Toast['kind']) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = (id: number) => setToasts(t => t.filter(x => x.id !== id));
  const toast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, kind, message }]);
    setTimeout(() => remove(id), 4000);
  }, []);

  return (
    <Ctx.Provider value={{
      toast,
      success: (m) => toast(m, 'success'),
      error: (m) => toast(m, 'error'),
    }}>
      {children}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-[min(92vw,400px)]">
        {toasts.map(t => (
          <div key={t.id} className="flex items-start gap-3 p-3.5 rounded-xl shadow-elevated border border-neutral-200 bg-white text-neutral-900 animate-slide-up">
            {t.kind === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />}
            {t.kind === 'error' && <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />}
            {t.kind === 'info' && <Info className="w-5 h-5 text-neutral-500 shrink-0 mt-0.5" />}
            <div className="flex-1">
              <div className="text-sm font-medium text-neutral-900">{t.message}</div>
              <div className="text-[9px] font-semibold text-neutral-400 uppercase tracking-wider mt-1">Waarwi</div>
            </div>
            <button onClick={() => remove(t.id)} className="text-neutral-400 hover:text-neutral-600"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used within ToastProvider');
  return v;
}
