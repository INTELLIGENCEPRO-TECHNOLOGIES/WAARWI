import { useState, useEffect } from 'react';
import { Delete } from 'lucide-react';

export type NumpadField = 'qty' | 'price' | 'discount';

export type NumpadTarget = {
  qty: number;
  price: number;
  discount: number;
};

type Props = {
  target: NumpadTarget;
  onCommit: (field: NumpadField, value: number) => void;
  canDiscount?: boolean;
  compact?: boolean;
};

export function PosNumpad({
  target,
  onCommit,
  canDiscount = true,
  compact = false,
}: Props) {
  const [activeField, setActiveField] = useState<NumpadField>('qty');
  const [buffer, setBuffer] = useState(String(target.qty));

  useEffect(() => {
    if (activeField === 'qty') setBuffer(String(target.qty));
    else if (activeField === 'price') setBuffer(target.price ? String(target.price) : '');
    else setBuffer(target.discount ? String(target.discount) : '');
  }, [activeField]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (val: string) => {
    const n = Number(val) || 0;
    if (activeField === 'qty') onCommit('qty', Math.max(1, n));
    else if (activeField === 'price') onCommit('price', Math.max(0, n));
    else onCommit('discount', Math.max(0, n));
  };

  const pressKey = (key: string) => {
    if (key === 'backspace') {
      const next = buffer.slice(0, -1);
      setBuffer(next);
      commit(next);
    } else {
      const next = buffer + key;
      setBuffer(next);
      commit(next);
    }
  };

  const switchField = (field: NumpadField) => {
    commit(buffer);
    setActiveField(field);
  };

  const clearField = () => {
    setBuffer('');
    commit('0');
  };

  const btnH = compact ? 'min-h-11 [@media(max-height:640px)]:min-h-8' : 'min-h-[52px]';
  const digitSize = compact ? 'text-base' : 'text-xl';
  const digitClass = `${btnH} ${digitSize} bg-[var(--w-surface)] font-semibold text-[var(--w-text)] transition-colors hover:bg-[var(--w-hover)] active:bg-[var(--w-active)]`;

  const valueSize = compact ? 'text-xs' : 'text-sm';

  const fieldBtn = (f: NumpadField, label: string, value: string) => (
    <button
      type="button"
      onClick={() => switchField(f)}
      aria-pressed={activeField === f}
      className={`flex-1 flex flex-col items-center justify-center py-1.5 transition-all ${
        activeField === f
          ? 'border-b-2 border-[var(--w-text)]'
          : 'border-b border-[var(--w-separator)] hover:border-[var(--w-text-muted)]'
      }`}
    >
      <span className={`text-[10px] font-bold uppercase tracking-wide ${activeField === f ? 'text-[var(--w-text)]' : 'text-[var(--w-text-muted)]'}`}>{label}</span>
      <span className={`${valueSize} font-semibold num ${activeField === f ? 'text-[var(--w-text)]' : 'text-[var(--w-text-sec)]'}`}>{value}</span>
    </button>
  );

  return (
    <div role="group" aria-label="Pavé numérique" className="flex flex-col">
      {/* Field selector row — underline style */}
      <div className="flex items-end gap-3 px-3 pt-2 pb-1 shrink-0">
        {fieldBtn('qty', 'Qté', activeField === 'qty' ? (buffer || '0') : String(target.qty))}
        {fieldBtn('price', 'Prix', activeField === 'price' ? (buffer || '0') : String(target.price))}
        {canDiscount && fieldBtn('discount', 'Remise', activeField === 'discount' ? (buffer || '0') : String(target.discount))}
      </div>

      <div className="grid grid-cols-3 gap-px border-t border-[var(--w-separator)] bg-[var(--w-separator)]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key => (
          <button type="button" key={key} onClick={() => pressKey(key)} className={digitClass}>{key}</button>
        ))}
        <button type="button" onClick={clearField} aria-label="Effacer la saisie"
          className={`${btnH} bg-[var(--w-surface-el2)] text-sm font-semibold text-[var(--w-text-sec)] transition-colors hover:bg-[var(--w-hover)] active:bg-[var(--w-active)]`}
        >C</button>
        <button type="button" onClick={() => pressKey('0')} className={digitClass}>0</button>
        <button type="button" onClick={() => pressKey('backspace')} aria-label="Effacer le dernier chiffre"
          className={`${btnH} flex items-center justify-center bg-[var(--w-surface-el2)] text-[var(--w-text-sec)] transition-colors hover:bg-[var(--w-hover)] active:bg-[var(--w-active)]`}
        ><Delete aria-hidden="true" className="h-4 w-4" /></button>
      </div>

    </div>
  );
}
