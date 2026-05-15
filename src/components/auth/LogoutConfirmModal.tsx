'use client';

import { useState } from 'react';
import { LogOut, X, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface LogoutConfirmModalProps {
  isOpen: boolean;
  hasOpenShift: boolean;
  shiftName?: string;
  onClose: () => void;
  onCloseShiftAndLogout: () => Promise<void>;
  onCloseShiftPrintAndLogout: () => Promise<void>;
  onLogoutOnly: () => Promise<void>;
}

export default function LogoutConfirmModal({
  isOpen,
  hasOpenShift,
  shiftName,
  onClose,
  onCloseShiftAndLogout,
  onCloseShiftPrintAndLogout,
  onLogoutOnly,
}: LogoutConfirmModalProps) {
  const [closingShift, setClosingShift] = useState(false);
  const [closingAndPrinting, setClosingAndPrinting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleCloseShiftAndLogout() {
    setClosingShift(true);
    try {
      await onCloseShiftAndLogout();
    } catch {
      // Error handled in parent
    } finally {
      setClosingShift(false);
    }
  }

  async function handleCloseShiftPrintAndLogout() {
    setClosingAndPrinting(true);
    try {
      await onCloseShiftPrintAndLogout();
    } catch {
      // Error handled in parent
    } finally {
      setClosingAndPrinting(false);
    }
  }

  async function handleLogoutOnly() {
    setLoggingOut(true);
    try {
      await onLogoutOnly();
    } catch {
      // Error handled in parent
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="w-5 h-5" />
            {hasOpenShift ? 'قبل تسجيل الخروج' : 'تسجيل الخروج'}
          </DialogTitle>
          <DialogDescription className="text-base">
            {hasOpenShift ? (
              <>
                لديك وردية مفتوحة حاليًا
                {shiftName && (
                  <span className="font-semibold"> ({shiftName})</span>
                )}
                . هل تريد إغلاق ورديتك قبل الخروج؟
              </>
            ) : (
              'هل تريد تسجيل الخروج؟'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 pt-4">
          {hasOpenShift ? (
            <>
              <Button
                onClick={handleCloseShiftPrintAndLogout}
                disabled={closingShift || closingAndPrinting || loggingOut}
                variant="default"
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {closingAndPrinting ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري إغلاق الوردية...
                  </>
                ) : (
                  <>
                    <Printer className="w-4 h-4 ml-2" />
                    إغلاق الوردية + طباعة الملخص
                  </>
                )}
              </Button>

              <Button
                onClick={handleCloseShiftAndLogout}
                disabled={closingShift || closingAndPrinting || loggingOut}
                variant="outline"
              >
                {closingShift ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري إغلاق الوردية...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 ml-2" />
                    إغلاق الوردية بدون طباعة
                  </>
                )}
              </Button>

              <Button
                onClick={handleLogoutOnly}
                disabled={closingShift || closingAndPrinting || loggingOut}
                variant="outline"
              >
                {loggingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الخروج...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 ml-2" />
                    تسجيل الخروج بدون إغلاق الوردية
                  </>
                )}
              </Button>

              <Button
                onClick={onClose}
                disabled={closingShift || closingAndPrinting || loggingOut}
                variant="ghost"
              >
                <X className="w-4 h-4 ml-2" />
                إلغاء
              </Button>
            </>
          ) : (
            <>
              <Button
                onClick={handleLogoutOnly}
                disabled={loggingOut}
                variant="default"
              >
                {loggingOut ? (
                  <>
                    <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                    جاري الخروج...
                  </>
                ) : (
                  <>
                    <LogOut className="w-4 h-4 ml-2" />
                    تسجيل الخروج
                  </>
                )}
              </Button>

              <Button
                onClick={onClose}
                disabled={loggingOut}
                variant="outline"
              >
                إلغاء
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
