import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session/SessionProvider";
import AuthLayout from "@/components/layout/AuthLayout";
import { PermissionsProvider } from "@/components/providers/PermissionsProvider";
import ThemeProvider from "@/components/providers/ThemeProvider";
import { ThemeInit } from "@/components/theme/ThemeInit";
import { cookies } from "next/headers";
import { parseThemeCookie } from "@/lib/theme";

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "نقطة البيع — Cut Salon",
  description: "نظام إدارة صالون Cut",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieHeader = (await cookies()).toString();
  const initialTheme = parseThemeCookie(cookieHeader);

  return (
    <html lang="ar" dir="rtl" className={`h-full antialiased ${cairo.variable}`} suppressHydrationWarning>
      <head>
        <ThemeInit />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans" suppressHydrationWarning>
        <ThemeProvider initialConfig={initialTheme}>
          <SessionProvider>
            <PermissionsProvider>
              {/* Mobile-first layout with conditional navigation */}
              <div className="flex flex-col h-[100dvh] overflow-hidden">
                <AuthLayout>
                  {children}
                </AuthLayout>
              </div>
            </PermissionsProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
