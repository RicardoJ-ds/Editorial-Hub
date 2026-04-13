import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Editorial Hub | Graphite",
  description: "Editorial operations management platform",
  icons: {
    icon: "/graphite-logo.png",
    apple: "/graphite-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${jetbrainsMono.variable} h-full dark`}
    >
      <body className="flex h-full min-h-screen bg-black text-white antialiased">
        <TooltipProvider>
          <Sidebar />
          <div className="ml-[240px] flex flex-1 flex-col overflow-auto">
            <div className="sticky top-0 z-30 bg-black">
              <Header />
            </div>
            <main className="flex-1 bg-black px-8 py-6">
              {children}
            </main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
