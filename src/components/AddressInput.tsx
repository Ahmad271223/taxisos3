"use client";

import { useEffect, useRef, useState } from "react";
import type { GeocodeResult } from "@/lib/geo";

interface Props {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (text: string) => void;
  onSelect: (result: GeocodeResult) => void;
  required?: boolean;
  hideLabel?: boolean;
  compact?: boolean;
}

export function AddressInput({ label, placeholder, value, onChange, onSelect, required, hideLabel, compact }: Props) {
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSelected = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    if (justSelected.current) {
      justSelected.current = false;
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(value)}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, active]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <label className={hideLabel ? "sr-only" : compact ? "label-sm" : "label"}>{label}</label>
      <input
        className={compact ? "field-sm" : "field"}
        data-testid={`address-input-${label.toLowerCase().includes("abhol") ? "pickup" : "dest"}`}
        placeholder={placeholder}
        value={value}
        required={required}
        autoComplete="off"
        onFocus={() => {
          setActive(true);
          if (results.length) setOpen(true);
        }}
        onChange={(e) => {
          setActive(true);
          onChange(e.target.value);
        }}
      />
      {loading && <span className={`absolute right-3 text-xs text-ink-400 ${compact ? "top-7" : "top-9"}`}>…</span>}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-ink-200 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm hover:bg-brand-50"
                onClick={() => {
                  justSelected.current = true;
                  onSelect(r);
                  setResults([]);
                  setOpen(false);
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
