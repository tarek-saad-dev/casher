export default function MainLayout({ children }: { children: React.ReactNode }) {
  // Navigation is handled by AuthLayout at root level
  // This layout is just a pass-through for route grouping
  return <>{children}</>;
}
