import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session/SessionProvider";
import AuthLayout from "@/components/layout/AuthLayout";
import GlobalAccessGuard from "@/components/guards/GlobalAccessGuard";
import { PermissionsProvider } from "@/components/providers/PermissionsProvider";
import ThemeProvider from "@/components/providers/ThemeProvider";
import { ThemeInit } from "@/components/theme/ThemeInit";
import PwaBootstrap from "@/components/pwa/PwaBootstrap";
import { cookies } from "next/headers";
import { parseThemeCookie } from "@/lib/theme";
import { CUT_SYSTEM_PWA } from "@/lib/pwa/apps";

const cairo = Cairo({
  subsets: ["arabic"],
  variable: "--font-cairo",
  display: "swap",
});

export const metadata: Metadata = {
  applicationName: CUT_SYSTEM_PWA.name,
  title: {
    default: "نقطة البيع",
    template: `%s · ${CUT_SYSTEM_PWA.shortName}`,
  },
  description: "DRVOERP — نظام إدارة المنشآت",
  manifest: CUT_SYSTEM_PWA.manifestUrl,
  appleWebApp: {
    capable: true,
    title: CUT_SYSTEM_PWA.shortName,
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: CUT_SYSTEM_PWA.appleTouchIcon,
    icon: [
      { url: CUT_SYSTEM_PWA.icon192, sizes: "192x192", type: "image/png" },
      { url: CUT_SYSTEM_PWA.icon512, sizes: "512x512", type: "image/png" },
    ],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: CUT_SYSTEM_PWA.themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
              <GlobalAccessGuard>
              {/* Mobile-first layout with conditional navigation */}
              <div className="flex flex-col h-[100dvh] overflow-hidden">
                <AuthLayout>
                  {children}
                </AuthLayout>
              </div>
              <PwaBootstrap />
              </GlobalAccessGuard>
            </PermissionsProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
