import type { Metadata } from "next";
import { Cairo } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/session/SessionProvider";
import MainNav from "@/components/layout/MainNav";
import ActiveSessionBar from "@/components/session/ActiveSessionBar";

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
    <html lang="ar" dir="rtl" className={`dark h-full antialiased ${cairo.variable}`}>
      <body className={`min-h-full flex flex-col bg-zinc-950 text-foreground font-sans`}>
        <SessionProvider>
          <div className="flex flex-col h-screen overflow-hidden">
            <ActiveSessionBar />
            <div className="flex flex-1 overflow-hidden">
              <MainNav />
              <main className="flex-1 overflow-y-auto">
                {children}
              </main>
            </div>
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
