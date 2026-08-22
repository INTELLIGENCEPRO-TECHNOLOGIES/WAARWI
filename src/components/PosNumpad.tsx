import { useState, useEffect } from 'react';
import { Check, Delete } from 'lucide-react';
import { formatFCFA } from '../lib/format';

export type NumpadField = 'qty' | 'price' | 'discount';

export type NumpadTarget = {
  qty: number;
  price: number;
  discount: number;
  total: number;
};

type Props = {
  target: NumpadTarget;
  onCommit: (field: NumpadField, value: number) => void;
  onValidate?: () => void;
  canDiscount?: boolean;
  compact?: boolean;
};

export function PosNumpad({
  target,
  onCommit,
  onValidate,
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

  const btnH = compact ? 'min-h-[44px]' : 'min-h-[52px]';
  const fontSize = compact ? 'text-sm' : 'text-base';
  const digitSize = compact ? 'text-base' : 'text-xl';

  const labelSize = compact ? 'text-[8px]' : 'text-[9px]';
  const valueSize = compact ? 'text-xs' : 'text-sm';
  const totalSize = compact ? 'text-[10px]' : 'text-[11px]';

  const fieldBtn = (f: NumpadField, label: string, value: string) => (
    <button
      onClick={() => switchField(f)}
      className={`flex-1 flex flex-col items-center justify-center py-1.5 transition-all ${
        activeField === f
          ? 'border-b-2 border-neutral-900'
          : 'border-b border-neutral-200 hover:border-neutral-400'
      }`}
    >
      <span className={`${labelSize} font-bold uppercase tracking-wide ${activeField === f ? 'text-neutral-900' : 'text-neutral-400'}`}>{label}</span>
      <span className={`${valueSize} font-black num ${activeField === f ? 'text-neutral-900' : 'text-neutral-600'}`}>{value}</span>
    </button>
  );

  const keys: string[] = canDiscount
    ? ['1','2','3','qty','4','5','6','discount','7','8','9','price','clear','0','ok','backspace']
    : ['1','2','3','qty','4','5','6','price','7','8','9','clear','0','ok','backspace'];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Field selector row — underline style */}
      <div className="flex items-end gap-3 px-3 pt-2 pb-1 shrink-0">
        {fieldBtn('qty', 'Qté', activeField === 'qty' ? (buffer || '0') : String(target.qty))}
        {fieldBtn('price', 'Prix', activeField === 'price' ? (buffer || '0') : String(target.price))}
        {canDiscount && fieldBtn('discount', 'Remise', activeField === 'discount' ? (buffer || '0') : String(target.discount))}
        <div className={`flex-1 flex flex-col items-center justify-center py-1.5 border-b border-neutral-200`}>
          <span className={`${labelSize} font-bold uppercase tracking-wide text-neutral-400`}>Total</span>
          <span className={`${totalSize} font-black num text-neutral-900`}>{formatFCFA(target.total)}</span>
        </div>
      </div>

      {/* Numeric keypad grid */}
      <div className={`grid flex-1 gap-px bg-neutral-200 border-t border-neutral-200 ${canDiscount ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {keys.map(key => {
          if (key === 'qty') return (
            <button key={key} onClick={() => switchField('qty')}
              className={`${btnH} flex items-center justify-center ${fontSize} font-bold transition-all active:scale-95 ${activeField === 'qty' ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-50 text-neutral-600'}`}
            >Qté</button>
          );
          if (key === 'price') return (
            <button key={key} onClick={() => switchField('price')}
              className={`${btnH} flex items-center justify-center ${fontSize} font-bold transition-all active:scale-95 ${activeField === 'price' ? 'bg-neutral-100 text-neutral-900' : 'bg-neutral-50 text-neutral-600'}`}
            >Prix</button>
          );
          if (key === 'discount') return (
            <button key={key} onClick={() => switchField('discount')}
              className={`${btnH} flex items-center justify-center ${fontSize} font-bold transition-all active:scale-95 ${activeField === 'discount' ? 'bg-amber-50 text-amber-800' : 'bg-neutral-50 text-neutral-600'}`}
            >%</button>
          );
          if (key === 'clear') return (
            <button key={key} onClick={clearField}
              className={`${btnH} flex items-center justify-center ${compact ? 'text-xs' : 'text-sm'} font-bold bg-amber-50 text-amber-700 transition-all active:scale-95`}
            >C</button>
          );
          if (key === 'ok') return (
            <button key={key} onClick={onValidate}
              className={`${btnH} flex items-center justify-center bg-neutral-900 text-white transition-all active:scale-95`}
            ><Check className={compact ? 'w-4 h-4' : 'w-5 h-5'} /></button>
          );
          if (key === 'backspace') return (
            <button key={key} onClick={() => pressKey('backspace')}
              className={`${btnH} flex items-center justify-center bg-red-50 text-red-600 transition-all active:scale-95`}
            ><Delete className={compact ? 'w-4 h-4' : 'w-5 h-5'} /></button>
          );
          return (
            <button key={key} onClick={() => pressKey(key)}
              className={`${btnH} flex items-center justify-center ${digitSize} font-semibold bg-white text-neutral-900 transition-all active:scale-95 active:bg-neutral-100`}
            >{key}</button>
          );
        })}
      </div>

    </div>
  );
}
