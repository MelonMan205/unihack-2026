import type { Metadata, Viewport } from "next";
import { Space_Mono } from "next/font/google";
import "./globals.css";

const appFont = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-app",
});

export const metadata: Metadata = {
  title: "Happs",
  description: "Happs helps you discover spontaneous events near you tonight.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/haps-logo.svg",
    shortcut: "/haps-logo.svg",
    apple: "/haps-logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={appFont.variable}>{children}</body>
    </html>
  );
}
