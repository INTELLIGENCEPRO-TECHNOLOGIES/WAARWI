import { useCallback, useMemo, useState, useRef, useEffect } from 'react';

export type ValidationRule<T> = {
  check: (value: any, allValues: T) => boolean | string;
  message: string;
  when?: (allValues: T) => boolean;
  /** Debounce async checks (ms) — avoids validating on every keystroke */
  debounce?: number;
};

export type FieldConfig = {
  required?: boolean;
  label?: string;
  validate?: ValidationRule<any>[];
  default?: any;
  /** Auto-fill from another field when this one is empty */
  copyFrom?: string;
  /** Transform value on change (e.g. uppercase, trim) */
  transform?: (value: any) => any;
  /** Only validate/show when this returns true */
  showWhen?: (allValues: any) => boolean;
  /** Compute this field's value from other fields whenever deps change */
  compute?: {
    deps: string[];
    fn: (allValues: any) => any;
  };
  /** Only validate after blur (not on every keystroke) */
  validateOnBlurOnly?: boolean;
};

export type FormSchema = Record<string, FieldConfig>;

export type FormState<T> = {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  setValue: (field: keyof T, value: any, validate?: boolean) => void;
  setValues: (values: Partial<T>) => void;
  setTouched: (field: keyof T) => void;
  validateField: (field: keyof T) => string | undefined;
  validateAll: () => boolean;
  isValid: boolean;
  reset: (values?: Partial<T>) => void;
  clearErrors: () => void;
};

/**
 * Lightweight form state manager with field-level validation,
 * smart defaults, conditional fields, and auto-fill from sibling fields.
 */
export function useForm<T extends Record<string, any>>(
  schema: FormSchema,
  initialValues: T,
): FormState<T> {
  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouchedState] = useState<Partial<Record<keyof T, boolean>>>({});
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  const computeError = useCallback(
    (field: string, allValues: T): string | undefined => {
      const config = schema[field];
      if (!config) return undefined;
      if (config.showWhen && !config.showWhen(allValues)) return undefined;

      const value = allValues[field];

      if (config.required) {
        const isEmpty =
          value === undefined ||
          value === null ||
          value === '' ||
          (typeof value === 'string' && !value.trim());
        if (isEmpty) return `${config.label || field} est obligatoire`;
      }

      if (config.validate) {
        for (const rule of config.validate) {
          if (rule.when && !rule.when(allValues)) continue;
          const result = rule.check(value, allValues);
          if (result === false) return rule.message;
          if (typeof result === 'string') return result;
        }
      }
      return undefined;
    },
    [schema],
  );

  const setValue = useCallback(
    (field: keyof T, rawValue: any, validate = true) => {
      const fieldKey = String(field);
      const config = schema[fieldKey];
      let value = rawValue;
      if (config?.transform) value = config.transform(rawValue);

      setValuesState(prev => {
        const next = { ...prev, [field]: value };

        // Auto-fill: copy from sibling if this field is being set to empty
        // and copyFrom is configured
        if (config?.copyFrom && !value && prev[config.copyFrom as keyof T]) {
          next[field] = prev[config.copyFrom as keyof T];
        }

        // If another field copies from this one and that field is empty,
        // propagate
        for (const [otherKey, otherConfig] of Object.entries(schema)) {
          if (
            otherConfig.copyFrom === fieldKey &&
            !next[otherKey as keyof T] &&
            value
          ) {
            next[otherKey as keyof T] = value;
          }
        }

        // Recompute derived fields that depend on this one
        for (const [otherKey, otherConfig] of Object.entries(schema)) {
          if (otherConfig.compute?.deps.includes(fieldKey)) {
            next[otherKey as keyof T] = otherConfig.compute.fn(next);
          }
        }

        const shouldValidate = validate && !config?.validateOnBlurOnly;
        if (shouldValidate) {
          const err = computeError(fieldKey, next);
          setErrors(prevErr => ({
            ...prevErr,
            [field]: err,
          }));
        }

        return next;
      });
    },
    [schema, computeError],
  );

  const setValues = useCallback((partial: Partial<T>) => {
    setValuesState(prev => ({ ...prev, ...partial }));
  }, []);

  const setTouched = useCallback((field: keyof T) => {
    setTouchedState(prev => ({ ...prev, [field]: true }));
    // Validate on blur if validateOnBlurOnly is set
    const config = schema[String(field)];
    if (config?.validateOnBlurOnly) {
      const err = computeError(String(field), values);
      setErrors(prev => ({ ...prev, [field]: err }));
    }
  }, [schema, computeError, values]);

  const validateField = useCallback(
    (field: keyof T): string | undefined => {
      const err = computeError(String(field), values);
      setErrors(prev => ({ ...prev, [field]: err }));
      return err;
    },
    [computeError, values],
  );

  const validateAll = useCallback((): boolean => {
    const newErrors: Partial<Record<keyof T, string>> = {};
    let hasError = false;
    for (const field of Object.keys(schema)) {
      const config = schema[field];
      if (config.showWhen && !config.showWhen(values)) continue;
      const err = computeError(field, values);
      if (err) {
        newErrors[field as keyof T] = err;
        hasError = true;
      }
    }
    setErrors(newErrors);
    setTouchedState(() => {
      const allTouched: Partial<Record<keyof T, boolean>> = {};
      for (const field of Object.keys(schema)) allTouched[field as keyof T] = true;
      return allTouched;
    });
    return !hasError;
  }, [schema, computeError, values]);

  const isValid = useMemo(() => {
    for (const field of Object.keys(schema)) {
      const config = schema[field];
      if (config.showWhen && !config.showWhen(values)) continue;
      if (computeError(field, values)) return false;
    }
    return true;
  }, [schema, values, computeError]);

  const reset = useCallback(
    (resetValues?: Partial<T>) => {
      setValuesState({ ...initialValues, ...resetValues } as T);
      setErrors({});
      setTouchedState({});
    },
    [initialValues],
  );

  const clearErrors = useCallback(() => setErrors({}), []);

  return {
    values,
    errors,
    touched,
    setValue,
    setValues,
    setTouched,
    validateField,
    validateAll,
    isValid,
    reset,
    clearErrors,
  };
}

// ── Validation helpers ─────────────────────────────────────────

export const validators = {
  email: (message = 'Email invalide'): ValidationRule<any> => ({
    check: (v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    message,
  }),

  phone: (message = 'Numéro de téléphone invalide'): ValidationRule<any> => ({
    check: (v: string) => !v || /^[+]?[\d\s()-]{6,}$/.test(v.trim()),
    message,
  }),

  minLength: (n: number, message?: string): ValidationRule<any> => ({
    check: (v: string) => !v || v.length >= n,
    message: message || `Minimum ${n} caractères`,
  }),

  positiveNumber: (message = 'Doit être un nombre positif'): ValidationRule<any> => ({
    check: (v: any) => v === '' || v === undefined || v === null || (!isNaN(Number(v)) && Number(v) >= 0),
    message,
  }),

  // Senegal phone: starts with 7 or 3, 9 digits
  senegalPhone: (message = 'Numéro sénégalais invalide (ex: 77 000 00 00)'): ValidationRule<any> => ({
    check: (v: string) => {
      if (!v) return true;
      const digits = v.replace(/[\s+()-]/g, '');
      return /^\d{9}$/.test(digits) && (digits.startsWith('7') || digits.startsWith('3'));
    },
    message,
  }),

  // International phone: 7-15 digits with optional country code
  phoneInternational: (message = 'Numéro de téléphone invalide'): ValidationRule<any> => ({
    check: (v: string) => {
      if (!v) return true;
      const digits = v.replace(/[\s+()-]/g, '');
      return /^\d{7,15}$/.test(digits);
    },
    message,
  }),

  // Number within range
  inRange: (min: number, max: number, message?: string): ValidationRule<any> => ({
    check: (v: any) => {
      if (v === '' || v === undefined || v === null) return true;
      const n = Number(v);
      return !isNaN(n) && n >= min && n <= max;
    },
    message: message || `Doit être entre ${min} et ${max}`,
  }),

  // Non-empty after trim
  nonEmpty: (message = 'Ne peut pas être vide'): ValidationRule<any> => ({
    check: (v: string) => !v || v.trim().length > 0,
    message,
  }),

  // Match another field's value (e.g. password confirmation)
  matches: (otherField: string, message = 'Les valeurs ne correspondent pas'): ValidationRule<any> => ({
    check: (v: any, allValues: any) => v === allValues[otherField],
    message,
  }),
};
