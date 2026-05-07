import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@rainbow-me/rainbowkit/styles.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import { Providers } from "./providers";
import { Toaster } from "sonner";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pay to Chat — your inbox, on your terms",
  description:
    "Get paid to read messages. Senders pay in USDC or USDT on Solana or Ethereum. The amount is hidden until you swipe to reveal.",
  metadataBase: new URL("https://paytochat.fun"),
  openGraph: {
    title: "Pay to Chat",
    description:
      "Your time is valuable. Make people pay to land in your inbox — in USDC or USDT.",
    url: "https://paytochat.fun",
    siteName: "Pay to Chat",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pay to Chat",
    description: "Make people pay to land in your inbox.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased font-sans`}
      >
        <Providers>{children}</Providers>
        <Toaster richColors theme="dark" position="top-center" />
      </body>
    </html>
  );
}
