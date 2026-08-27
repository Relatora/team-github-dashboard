import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Team GitHub Dashboard",
  description:
    "Measure real engineering work across every repository and branch in your organization, with generated-file noise removed.",
};

/**
 * Props are typed explicitly rather than with Next's generated LayoutProps
 * global. That global lives in .next/types and does not exist on a clean
 * checkout until `next build` has run, so using it makes `tsc --noEmit`
 * depend on a build having happened first. CI ran typecheck before build and
 * failed on exactly that.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
