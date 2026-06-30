import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { MainLayoutWrapper } from "@/components/MainLayoutWrapper";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "791 Soluções - Command Center",
  description: "Super Admin Global para 791glass e 791barber",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} font-sans h-full antialiased`}
    >
      <body className="h-full bg-[#f8fafc] text-slate-900 overflow-hidden">
        <MainLayoutWrapper>{children}</MainLayoutWrapper>
      </body>
    </html>
  );
}
