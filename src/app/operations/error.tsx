'use client';

export default function OperationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <p className="text-base font-semibold text-foreground">تعذر تحميل لوحة التشغيل</p>
      <p className="max-w-md text-sm text-muted-foreground" dir="ltr">
        {error.message || 'Unknown error'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        إعادة المحاولة
      </button>
    </div>
  );
}
