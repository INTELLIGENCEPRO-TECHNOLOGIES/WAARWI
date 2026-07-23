import { useState, type ReactNode, useEffect, useRef } from 'react';
import { ChevronDown, AlertCircle, Check, X, Loader2, Eye, EyeOff, Sparkles } from 'lucide-react';

// ── FormField ───────────────────────────────────────────────────

export function FormField({
  label,
  error,
  touched,
  required,
  children,
  full,
  hint,
  valid,
}: {
  label?: string;
  error?: string;
  touched?: boolean;
  required?: boolean;
  children: ReactNode;
  full?: boolean;
  hint?: string;
  valid?: boolean;
}) {
  const showError = touched && error;
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="label mb-0">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          {valid && !showError && (
            <Check className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </div>
      )}
      {children}
      {showError ? (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-500">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      ) : hint ? (
        <p className="mt-1 text-xs text-neutral-400">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Input with built-in validation display ─────────────────────

export function ValidatedInput({
  value,
  onChange,
  onBlur,
  error,
  touched,
  label,
  required,
  full,
  hint,
  type = 'text',
  placeholder,
  autoFocus,
  className = 'input',
  min,
  max,
  maxLength,
}: {
  value: string | number;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  label?: string;
  required?: boolean;
  full?: boolean;
  hint?: string;
  type?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  min?: number;
  max?: number;
  maxLength?: number;
}) {
  const showError = touched && error;
  const inputClass = `${className} ${
    showError
      ? 'border-red-300 focus:ring-red-500/10 focus:border-red-400'
      : touched && !error && value
        ? 'border-emerald-300 focus:ring-emerald-500/10 focus:border-emerald-400'
        : ''
  }`;

  return (
    <FormField
      label={label}
      error={error}
      touched={touched}
      required={required}
      full={full}
      hint={hint}
      valid={touched && !error && !!value}
    >
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        className={inputClass}
        placeholder={placeholder}
        autoFocus={autoFocus}
        min={min}
        max={max}
        maxLength={maxLength}
      />
    </FormField>
  );
}

// ── CollapsibleSection (progressive disclosure) ─────────────────

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  badge,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: string | number;
  subtitle?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3.5 py-2.5 bg-neutral-50 hover:bg-neutral-100 transition-colors"
      >
        <div className="flex items-center gap-2 text-left">
          <div>
            <div className="text-sm font-semibold text-neutral-800">{title}</div>
            {subtitle && (
              <div className="text-xs text-neutral-400">{subtitle}</div>
            )}
          </div>
          {badge !== undefined && badge !== '' && badge !== 0 && (
            <span className="badge bg-neutral-200 text-neutral-700">{badge}</span>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-neutral-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 animate-[fadeIn_0.15s_ease]">
          {children}
        </div>
      )}
    </div>
  );
}

// ── FieldGroup (logical grouping without collapse) ────────────

export function FieldGroup({
  title,
  children,
  columns = 2,
  hint,
}: {
  title?: string;
  children: ReactNode;
  columns?: 1 | 2 | 3;
  hint?: string;
}) {
  const colsClass = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' };
  return (
    <div className="space-y-2.5">
      {title && (
        <div>
          <div className="text-sm font-semibold text-neutral-800">{title}</div>
          {hint && <div className="text-xs text-neutral-500">{hint}</div>}
        </div>
      )}
      <div className={`grid ${colsClass[columns]} gap-3`}>{children}</div>
    </div>
  );
}

// ── ConditionalField (show/hide with animation) ────────────────

export function ConditionalField({
  show,
  children,
  animate = true,
}: {
  show: boolean;
  children: ReactNode;
  animate?: boolean;
}) {
  if (!show) return null;
  return (
    <div className={animate ? 'animate-[fadeIn_0.15s_ease]' : ''}>
      {children}
    </div>
  );
}

// ── SmartInput (auto-suggest + smart defaults indicator) ──────

export function SmartInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  touched,
  required,
  full,
  hint,
  placeholder,
  type = 'text',
  autoFocus,
  min,
  max,
  maxLength,
  /** Show a sparkle icon when a smart default was auto-filled */
  smartDefault,
  /** Suggest a value (shown as ghost text inside the field) */
  suggestion,
  onAcceptSuggestion,
  className = '',
}: {
  label?: string;
  value: string | number;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  full?: boolean;
  hint?: string;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  smartDefault?: boolean;
  suggestion?: string;
  onAcceptSuggestion?: () => void;
  className?: string;
}) {
  const showError = touched && error;
  const inputClass = `input ${className} ${smartDefault ? 'pr-9' : ''} ${
    showError
      ? 'border-red-300 focus:ring-red-500/10 focus:border-red-400'
      : touched && !error && value
        ? 'border-emerald-300 focus:ring-emerald-500/10 focus:border-emerald-400'
        : ''
  }`;

  return (
    <FormField
      label={label}
      error={error}
      touched={touched}
      required={required}
      full={full}
      hint={hint}
      valid={touched && !error && !!value}
    >
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          className={inputClass}
          placeholder={suggestion && !value ? suggestion : placeholder}
          autoFocus={autoFocus}
          min={min}
          max={max}
          maxLength={maxLength}
        />
        {smartDefault && (
          <Sparkles className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-amber-400 pointer-events-none" />
        )}
        {suggestion && !value && onAcceptSuggestion && (
          <button
            type="button"
            onClick={onAcceptSuggestion}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-brand-600 hover:text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded-md transition-colors"
          >
            Utiliser
          </button>
        )}
      </div>
    </FormField>
  );
}

// ── PasswordInput (show/hide toggle) ──────────────────────────

export function PasswordInput({
  label,
  value,
  onChange,
  onBlur,
  error,
  touched,
  required,
  full,
  hint,
  placeholder,
  autoFocus,
  className = '',
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  error?: string;
  touched?: boolean;
  required?: boolean;
  full?: boolean;
  hint?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [show, setShow] = useState(false);
  const showError = touched && error;
  const inputClass = `input ${className} pr-10 ${
    showError
      ? 'border-red-300 focus:ring-red-500/10 focus:border-red-400'
      : touched && !error && value
        ? 'border-emerald-300 focus:ring-emerald-500/10 focus:border-emerald-400'
        : ''
  }`;

  return (
    <FormField
      label={label}
      error={error}
      touched={touched}
      required={required}
      full={full}
      hint={hint}
      valid={touched && !error && !!value}
    >
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          className={inputClass}
          placeholder={placeholder}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
          tabIndex={-1}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </FormField>
  );
}

// ── Stepper (multi-step form progress) ────────────────────────

export function Stepper({
  steps,
  current,
  onStepClick,
}: {
  steps: { label: string; optional?: boolean }[];
  current: number;
  onStepClick?: (index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {steps.map((step, i) => {
        const isDone = i < current;
        const isCurrent = i === current;
        const isClickable = onStepClick && i <= current;
        return (
          <div key={i} className="flex items-center gap-1 sm:gap-2 flex-1">
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick?.(i)}
              className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                isCurrent ? 'text-brand-700' : isDone ? 'text-emerald-600' : 'text-neutral-400'
              } ${isClickable ? 'cursor-pointer hover:text-brand-600' : 'cursor-default'}`}
            >
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                  isCurrent
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : isDone
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-neutral-300 text-neutral-400'
                }`}
              >
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
              {step.optional && <span className="text-[9px] text-neutral-400">(opt.)</span>}
            </button>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 rounded-full ${isDone ? 'bg-emerald-400' : 'bg-neutral-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── FormActions (sticky submit bar with smart state) ──────────

export function FormActions({
  onCancel,
  onSubmit,
  submitLabel = 'Enregistrer',
  cancelLabel = 'Annuler',
  isValid = true,
  isSubmitting = false,
  hint,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  isValid?: boolean;
  isSubmitting?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 pt-3 border-t border-neutral-200">
      <div className="text-xs text-neutral-500">
        {hint || (isValid ? '' : 'Veuillez corriger les erreurs')}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-icon"
          disabled={isSubmitting}
          title={cancelLabel}
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!isValid || isSubmitting}
          className="btn-icon-primary disabled:opacity-50 disabled:cursor-not-allowed"
          title={submitLabel}
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
