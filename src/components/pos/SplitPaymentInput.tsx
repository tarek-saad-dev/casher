'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banknote, CreditCard, Wallet, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { PaymentMethod, PaymentAllocation } from '@/lib/types';

interface SplitPaymentInputProps {
  methods: PaymentMethod[];
  grandTotal: number;
  allocations: PaymentAllocation[];
  onChange: (allocations: PaymentAllocation[]) => void;
}

export default function SplitPaymentInput({ 
  methods, 
  grandTotal, 
  allocations, 
  onChange 
}: SplitPaymentInputProps) {
  // Initialize allocations when methods change
  useEffect(() => {
    if (allocations.length === 0 && methods.length > 0) {
      // Default: all to first method (usually Cash)
      const defaultAllocations = methods.map((m, index) => ({
        paymentMethodId: m.ID,
        amount: index === 0 ? grandTotal : 0,
      }));
      onChange(defaultAllocations);
    }
  }, [methods, grandTotal, allocations.length, onChange]);

  const handleAmountChange = useCallback((paymentMethodId: number, value: string) => {
    const amount = parseFloat(value) || 0;
    const newAllocations = allocations.map(pa =>
      pa.paymentMethodId === paymentMethodId
        ? { ...pa, amount }
        : pa
    );
    onChange(newAllocations);
  }, [allocations, onChange]);

  const handleSetFullAmount = useCallback((paymentMethodId: number) => {
    // Set full amount to this method, zero to others
    const newAllocations = methods.map(m => ({
      paymentMethodId: m.ID,
      amount: m.ID === paymentMethodId ? grandTotal : 0,
    }));
    onChange(newAllocations);
  }, [methods, grandTotal, onChange]);

  const totalAllocated = allocations.reduce((sum, pa) => sum + pa.amount, 0);
  const remaining = grandTotal - totalAllocated;
  const isBalanced = Math.abs(remaining) < 0.01;
  const hasMultiplePayments = allocations.filter(pa => pa.amount > 0).length > 1;

  // Determine main payment method (largest amount)
  const mainPayment = [...allocations].sort((a, b) => b.amount - a.amount)[0];
  const mainMethod = methods.find(m => m.ID === mainPayment?.paymentMethodId);

  const getIcon = (name: string) => {
    if (name.includes('كاش') || name.includes('Cash')) return <Banknote className="w-4 h-4" />;
    if (name.includes('فيزا') || name.includes('Visa') || name.includes('كارت')) return <CreditCard className="w-4 h-4" />;
    return <Wallet className="w-4 h-4" />;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">تفاصيل الدفع</h3>
        <span className="text-xs text-muted-foreground">
          الإجمالي: {formatCurrency(grandTotal)}
        </span>
      </div>

      {/* Payment Method Inputs */}
      <div className="space-y-2">
        {methods.map((method) => {
          const allocation = allocations.find(pa => pa.paymentMethodId === method.ID);
          const amount = allocation?.amount || 0;
          const isMain = mainPayment?.paymentMethodId === method.ID && hasMultiplePayments;

          return (
            <div 
              key={method.ID} 
              className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                amount > 0 
                  ? isMain 
                    ? 'border-primary bg-primary/5' 
                    : 'border-border bg-surface-muted/30'
                  : 'border-transparent'
              }`}
            >
              <div className={`p-1.5 rounded ${amount > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                {getIcon(method.Name)}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${amount > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {method.Name}
                  </span>
                  {isMain && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                      رئيسي
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount || ''}
                  onChange={(e) => handleAmountChange(method.ID, e.target.value)}
                  className="w-24 text-right h-8 text-sm"
                  placeholder="0.00"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSetFullAmount(method.ID)}
                  className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  الكل
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Balance Status */}
      <div className={`p-2.5 rounded-lg text-sm ${
        isBalanced 
          ? 'bg-success/10 border border-success/20' 
          : 'bg-warning/10 border border-warning/20'
      }`}>
        <div className="flex items-center gap-2">
          {isBalanced ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-success" />
              <span className="text-success">
                {hasMultiplePayments 
                  ? `دفع مختلط: ${mainMethod?.Name} (${formatCurrency(mainPayment?.amount || 0)})`
                  : 'تم التوزيع بنجاح'
                }
              </span>
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-warning" />
              <span className="text-warning">
                {remaining > 0 
                  ? `متبقي: ${formatCurrency(remaining)}`
                  : `زائد: ${formatCurrency(Math.abs(remaining))}`
                }
              </span>
            </>
          )}
        </div>
        
        {hasMultiplePayments && isBalanced && (
          <div className="mt-2 text-xs text-muted-foreground border-t border-border pt-2">
            سيتم تسجيل الفاتورة بـ <strong className="text-muted-foreground">{mainMethod?.Name}</strong> ثم تسوية تلقائية
          </div>
        )}
      </div>
    </div>
  );
}
