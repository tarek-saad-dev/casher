import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session/SessionProvider";
import AuthLayout from "@/components/layout/AuthLayout";
import GlobalAccessGuard from "@/components/guards/GlobalAccessGuard";
import { PermissionsProvider } from "@/components/providers/PermissionsProvider";

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نقطة البيع — Cut Salon",
  description: "نظام إدارة صالون Cut",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" className={`dark h-full antialiased ${cairo.variable}`} suppressHydrationWarning>
      <body className={`min-h-full flex flex-col bg-zinc-950 text-foreground font-sans`} suppressHydrationWarning>
        <SessionProvider>
          <PermissionsProvider>
            <GlobalAccessGuard>
              {/* Mobile-first layout with conditional navigation */}
              <div className="flex flex-col h-[100dvh] overflow-hidden">
                <AuthLayout>
                  {children}
                </AuthLayout>
              </div>
            </GlobalAccessGuard>
          </PermissionsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
