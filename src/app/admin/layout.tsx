export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="box-border flex h-full min-h-0 flex-col p-6">
      {children}
    </div>
  );
}
