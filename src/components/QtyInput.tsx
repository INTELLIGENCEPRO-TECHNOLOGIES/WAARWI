import { forwardRef, useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | null | undefined;
  onValueChange: (n: number) => void;
};

const parse = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return isNaN(n) ? null : n;
};

export const QtyInput = forwardRef<HTMLInputElement, Props>(function QtyInput({ value, onValueChange, ...rest }, ref) {
  const [text, setText] = useState(value ? String(value).replace('.', ',') : '');

  useEffect(() => {
    const current = parse(text) ?? 0;
    if ((value || 0) !== current) setText(value ? String(value).replace('.', ',') : '');
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      onChange={e => {
        const raw = e.target.value.replace('.', ',');
        if (!/^\d*(,\d{0,3})?$/.test(raw)) return;
        setText(raw);
        onValueChange(parse(raw) ?? 0);
      }}
      {...rest}
    />
  );
});
