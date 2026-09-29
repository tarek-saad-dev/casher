'use client';

import { useState } from 'react';
import { LogOut, X, Loader2, Lock } from 'lucide-react';
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
  /** Opens shift-close / recon panel, then logout after success. */
  onCloseShift: () => void;
  onLogoutOnly: () => Promise<void>;
}

export default function LogoutConfirmModal({
  isOpen,
  hasOpenShift,
  shiftName,
  onClose,
  onCloseShift,
  onLogoutOnly,
}: LogoutConfirmModalProps) {
  const [loggingOut, setLoggingOut] = useState(false);

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
                . أغلق الوردية أولاً ثم يتم تسجيل الخروج.
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
                onClick={() => {
                  onClose();
                  onCloseShift();
                }}
                disabled={loggingOut}
                variant="default"
                className="bg-amber-600 hover:bg-amber-700"
              >
                <Lock className="w-4 h-4 ml-2" />
                إغلاق الوردية
              </Button>

              <Button
                onClick={onClose}
                disabled={loggingOut}
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
