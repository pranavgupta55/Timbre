import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { Background } from "@/components/layout/Background";
import { AuthProvider } from "@/context/AuthContext";
import { AudioProvider } from "@/context/AudioContext";

const glosa = localFont({ src: "../public/fonts/Glosa-W01-Black.ttf", variable: "--font-glosa" });
const slippery = localFont({ src: "../public/fonts/SlipperyTrial-Regular.otf", variable: "--font-slippery" });

export const metadata: Metadata = { title: "Timbre | Tactical Audio", description: "Audio Editor & Player" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${glosa.variable} ${slippery.variable} font-sans`}>
      <body className="relative min-h-screen selection:bg-accent-gold/20 selection:text-accent-gold">
        <Background />
        <AuthProvider>
          <AudioProvider>
            <main className="relative z-10 flex min-h-screen flex-col items-center px-6 py-24">
              <div className="w-full max-w-5xl">{children}</div>
            </main>
          </AudioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}