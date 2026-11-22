import type { Metadata, Viewport } from "next";
import { Fraunces, Geist } from "next/font/google";

import "./globals.css";

// Clean sans-serif for everything you read.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// A warm serif for headings and profile prompts, Hinge-style.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Roomie · Flats & flatmates near SRM KTR",
  description:
    "Find flatmates you'll actually get along with, and a place to share, near SRM Kattankulathur.",
  applicationName: "Roomie",
  // The manifest link is added automatically from app/manifest.ts.
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iPhone/iPad: open full screen from the home screen, named "Roomie".
  appleWebApp: {
    capable: true,
    title: "Roomie",
    statusBarStyle: "default",
  },
  // Stop iOS turning rent amounts into tappable phone numbers.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#FAF9F6",
  width: "device-width",
  initialScale: 1,
  // Lets the bottom bars use env(safe-area-inset-bottom) on notched phones.
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${fraunces.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
