'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock, Scissors, RotateCcw, Receipt, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PosHeaderProps {
  shiftId: number | null;
  shiftLevel: string | null;
  onNewSale: () => void;
}

export default function PosHeader({ shiftId, shiftLevel, onNewSale }: PosHeaderProps) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
          <Scissors className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight">نقطة البيع</h1>
          <p className="text-xs text-muted-foreground">Hawai Salon</p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {shiftId && (
          <div className="text-xs text-muted-foreground">
            وردية #{shiftId}
            {shiftLevel === 'closed_today' && <span className="text-yellow-500 mr-1">(مغلقة)</span>}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <Clock className="w-4 h-4" />
          {time}
        </div>

        <Button variant="outline" size="sm" onClick={onNewSale}>
          <RotateCcw className="w-4 h-4 ml-2" />
          فاتورة جديدة
        </Button>
        <Link href="/expenses">
          <Button variant="outline" size="sm">
            <Receipt className="w-4 h-4 ml-2" />
            المصروفات
          </Button>
        </Link>
        <Link href="/admin/day">
          <Button variant="ghost" size="sm">
            <Settings className="w-4 h-4 ml-2" />
            الإدارة
          </Button>
        </Link>
      </div>
    </header>
  );
}
