import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, Search } from 'lucide-react';
import {
  COUNTRY_DIALS,
  DEFAULT_DIAL,
  findCountryDialByDial,
  findCountryDialByIso,
  type CountryDial,
} from '../../utils/countryDialCodes';
import { CountryFlag } from '../common/CountryFlag';
import { detectCountryIso } from '../../utils/detectCountry';
import type { PhoneValue } from '../../utils/phone';
import { authInputClass } from './AuthSplitLayout';

interface PhoneFieldProps {
  id: string;
  label: string;
  value: PhoneValue;
  onChange: (value: PhoneValue) => void;
  error?: string | null;
  hint?: string;
  /** When true (default), IP geolocation pre-selects the dial code once on
   *  mount — non-blocking, +995 default kept until it resolves, never
   *  overrides a manual user choice. */
  autoDetect?: boolean;
  autoFocus?: boolean;
}

/**
 * Phone field: searchable country-code picker (flag + name + dial code,
 * default +995, IP-based pre-select) next to a national-number input.
 *
 * Keyboard: Tab to the picker → Enter/Space opens → type to search →
 * ArrowUp/ArrowDown moves → Enter picks → Escape closes. The listbox
 * follows ARIA listbox conventions.
 */
export const PhoneField: React.FC<PhoneFieldProps> = ({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  autoDetect = true,
  autoFocus = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  /** Set the moment the user picks a code manually — auto-detect never wins. */
  const userTouchedRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const picked = pickedIso ? findCountryDialByIso(pickedIso) : undefined;
  const selected = picked && picked.dial === value.dialCode ? picked : findCountryDialByDial(value.dialCode);

  /* Non-blocking IP pre-select: +995 renders immediately; the picker updates
   * once the lookup resolves. Skipped entirely if the user already chose. */
  useEffect(() => {
    if (!autoDetect) return;
    let cancelled = false;
    detectCountryIso(3000).then((iso) => {
      if (cancelled || userTouchedRef.current || !iso) return;
      const match = findCountryDialByIso(iso);
      if (match && match.dial !== DEFAULT_DIAL) {
        setPickedIso(match.iso);
        onChange({ dialCode: match.dial, number: valueRef.current.number });
      }
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount; value is read via ref so the lookup never
    // re-fires on keystrokes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valueRef = useRef(value);
  valueRef.current = value;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRY_DIALS;
    return COUNTRY_DIALS.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.replace('+', '').startsWith(q.replace('+', '')) ||
        c.iso.toLowerCase() === q ||
        (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
    );
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /* Close on outside click / Escape handled on keydown; scroll active into view. */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    // Focus the search box when the dropdown opens.
    searchRef.current?.focus();
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const pick = (c: CountryDial) => {
    userTouchedRef.current = true;
    setPickedIso(c.iso);
    onChange({ ...valueRef.current, dialCode: c.dial });
    setOpen(false);
    setQuery('');
  };

  const onPickerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[activeIndex];
      if (c) pick(c);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="block text-[13px] font-semibold text-slate-700 dark:text-gray-300">
          {label}
        </label>
      </div>

      <div className="flex gap-2">
        {/* Country-code picker */}
        <div ref={rootRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            onKeyDown={onPickerKeyDown}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Country code, currently ${selected ? `${selected.name} ${selected.dial}` : value.dialCode}`}
            className={`${authInputClass} !w-auto !px-3 flex items-center gap-1.5 font-semibold whitespace-nowrap cursor-pointer`}
          >
            {selected && <CountryFlag iso={selected.iso} className="w-[22px] h-4" />}
            <span className="text-[15px]">{value.dialCode}</span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 dark:text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>

          {open && (
            <div className="absolute z-50 top-[calc(100%+8px)] left-0 w-[min(320px,calc(100vw-48px))] bg-white dark:bg-[#0C1322] border-2 border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl shadow-slate-900/15 overflow-hidden">
              <div className="p-2 border-b border-slate-100 dark:border-white/10">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onListKeyDown}
                    placeholder="Search country or code…"
                    aria-label="Search countries"
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={`${id}-country-listbox`}
                    aria-activedescendant={`${id}-country-opt-${activeIndex}`}
                    className="w-full min-h-[44px] pl-9 pr-3 text-[15px] text-slate-900 dark:text-gray-100 bg-slate-50 dark:bg-white/5 rounded-xl placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#168BFF]/40"
                  />
                </div>
              </div>
              <div
                ref={listRef}
                id={`${id}-country-listbox`}
                role="listbox"
                aria-label="Country codes"
                className="max-h-[264px] overflow-y-auto py-1.5 overscroll-contain"
              >
                {filtered.length === 0 && (
                  <p className="px-4 py-6 text-sm text-slate-500 dark:text-gray-400 text-center">
                    No country matches “{query}”.
                  </p>
                )}
                {filtered.map((c, i) => {
                  const isSelected = c.iso === selected?.iso;
                  const isActive = i === activeIndex;
                  return (
                    <div
                      key={c.iso}
                      id={`${id}-country-opt-${i}`}
                      data-option-index={i}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => pick(c)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`flex items-center gap-2.5 px-4 min-h-[48px] cursor-pointer text-[15px] ${
                        isActive ? 'bg-[#168BFF]/10 dark:bg-[#168BFF]/15' : ''
                      } ${isSelected ? 'font-bold text-slate-900 dark:text-gray-100' : 'text-slate-700 dark:text-gray-300'}`}
                    >
                      <CountryFlag iso={c.iso} className="w-6 h-[18px]" />
                      <span className="flex-1 truncate">{c.name}</span>
                      <span className="text-slate-500 dark:text-gray-400 font-semibold">{c.dial}</span>
                      {isSelected && <Check className="w-4 h-4 text-[#168BFF] shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* National number */}
        <input
          id={id}
          type="tel"
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.target.value })}
          placeholder="50 123 4567"
          autoComplete="tel-national"
          inputMode="tel"
          autoFocus={autoFocus}
          aria-invalid={!!error}
          className={`${authInputClass} flex-1 min-w-0`}
        />
      </div>

      {hint && !error && (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-gray-400">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400 flex items-center gap-1" role="alert">
          <AlertCircle className="w-3.5 h-5 shrink-0" /> {error}
        </p>
      )}
    </div>
  );
};
