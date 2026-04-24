import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

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
      <body className="flex h-screen bg-[#f8fafc] text-slate-900 overflow-hidden">
        <Sidebar />
        <div className="flex flex-1 flex-col h-full overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-6 lg:p-8 bg-[#f8fafc]">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
