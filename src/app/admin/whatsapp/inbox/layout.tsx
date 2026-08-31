/**
 * Full-bleed Inbox shell inside admin `p-6`.
 * Parent `<main>` is overflow-locked for this route (AuthenticatedAppShell).
 * `calc(100% + 3rem)` cancels the admin padding so height = main viewport.
 */
export default function WhatsAppInboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] max-h-[calc(100%+3rem)] min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
