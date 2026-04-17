'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, UserPlus, X, Phone, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Customer } from '@/lib/types';

interface CustomerSearchProps {
  selected: Customer | null;
  onSelect: (customer: Customer | null) => void;
  onQuickAdd: () => void;
}

export default function CustomerSearch({ selected, onSelect, onQuickAdd }: CustomerSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback(async (q: string) => {
    if (q.length < 1) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
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

  if (selected) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">العميل</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onSelect(null)}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary">
            <User className="w-4 h-4" />
          </div>
          <div>
            <p className="font-semibold text-sm">{selected.Name}</p>
            {selected.Mobile && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="w-3 h-3" /> {selected.Mobile}
              </p>
            )}
          </div>
        </div>
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
          {results.length === 0 && query.length >= 1 && !loading && (
            <div className="p-3 text-center text-sm text-muted-foreground">
              لا توجد نتائج
            </div>
          )}
          {results.map((c) => (
            <button
              key={c.ClientID}
              onClick={() => { onSelect(c); setQuery(''); setOpen(false); }}
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
          <button
            onClick={() => { setOpen(false); onQuickAdd(); }}
            className="w-full text-right px-3 py-2.5 border-t border-border hover:bg-accent flex items-center gap-3 text-primary transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            <span className="text-sm font-medium">إضافة عميل جديد</span>
          </button>
        </div>
      )}
    </div>
  );
}
