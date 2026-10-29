import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusEnhancer · Natural subject deblurring",
  description:
    "Recover focus on blurry subjects directly in your browser. PSF-based deconvolution with fidelity controls, no generative retouching, and no uploads.",
};

export const viewport: Viewport = {
  themeColor: "#090D16",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
