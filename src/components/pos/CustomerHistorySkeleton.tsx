export default function CustomerHistorySkeleton() {
  return (
    <div className="space-y-3 animate-pulse" dir="rtl">
      {/* Header skeleton */}
      <div className="h-4 w-32 bg-muted rounded" />
      
      {/* Sales skeletons */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="p-3 rounded-lg border border-border bg-card space-y-2">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 bg-muted rounded" />
            <div className="h-3 w-16 bg-muted rounded" />
          </div>
          <div className="h-3 w-full bg-muted rounded" />
          <div className="h-3 w-3/4 bg-muted rounded" />
        </div>
      ))}
      
      {/* Summary skeleton */}
      <div className="p-3 rounded-lg border border-border bg-card space-y-2">
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-5/6 bg-muted rounded" />
        <div className="h-3 w-4/5 bg-muted rounded" />
      </div>
      
      {/* Recommendation skeleton */}
      <div className="p-3 rounded-lg border border-border bg-card">
        <div className="h-3 w-full bg-muted rounded" />
      </div>
    </div>
  );
}
