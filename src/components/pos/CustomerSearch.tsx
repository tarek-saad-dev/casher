'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, UserPlus, X, Phone, User, Cake, FileText, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Customer } from '@/lib/types';

interface CustomerSearchProps {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
  onQuickAdd: (prefill?: string) => void;
  onCompleteData?: (customer: Customer) => void;
}

export default function CustomerSearch({ selected, onSelect, onQuickAdd, onCompleteData }: CustomerSearchProps) {
  const [searched, setSearched] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
      setSearched(true);
      setOpen(true);
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const formatBirthDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const hasMissingData = selected && (
    !selected.BirthDate || !selected.Address
  );

  if (selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">العميل</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onSelect(null)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0 mt-0.5">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold text-sm">{selected.Name}</p>
            {selected.Mobile && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" /> {selected.Mobile}
              </p>
            )}
            {selected.BirthDate && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Cake className="w-3 h-3" /> {formatBirthDate(selected.BirthDate)}
              </p>
            )}
            {selected.Notes && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="w-3 h-3" />
                <span className="truncate max-w-[200px]">{selected.Notes}</span>
              </p>
            )}
          </div>
        </div>

        {hasMissingData && onCompleteData && (
          <button
            onClick={() => onCompleteData(selected)}
            className="mt-2.5 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 text-xs font-medium hover:bg-amber-500/10 transition-colors"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>بيانات ناقصة — اضغط لإتمامها</span>
            <span className="mr-auto flex gap-0.5">
              {!selected.BirthDate && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
              {!selected.Address   && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder="بحث بالاسم أو الموبايل..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          className="pr-10 text-sm"
        />
        {loading && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {open && (
        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.map((c) => (
            <button
              key={c.ClientID}
              onClick={() => { onSelect(c); setQuery(''); setOpen(false); setSearched(false); }}
              className="w-full text-right px-3 py-2.5 hover:bg-accent flex items-center gap-3 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{c.Name}</p>
                {c.Mobile && <p className="text-xs text-muted-foreground">{c.Mobile}</p>}
              </div>
            </button>
          ))}
          {searched && results.length === 0 && !loading ? (
            <button
              onClick={() => { setOpen(false); onQuickAdd(query); }}
              className="w-full text-right px-3 py-3 hover:bg-accent flex items-center gap-3 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 shrink-0">
                <UserPlus className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-400">تسجيل هذا العميل</p>
                <p className="text-xs text-muted-foreground truncate">«{query}» غير موجود — اضغط للتسجيل</p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => { setOpen(false); onQuickAdd(); }}
              className="w-full text-right px-3 py-2.5 border-t border-border hover:bg-accent flex items-center gap-3 text-primary transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              <span className="text-sm font-medium">إضافة عميل جديد</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
