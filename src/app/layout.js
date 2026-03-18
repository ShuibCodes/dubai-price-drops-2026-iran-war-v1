import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata = {
  title: "DXB Dip",
  description:
    "Track Dubai rental price drops below pre-war averages. Real-time listings ranked by biggest savings — free WhatsApp alerts when deals appear.",
  keywords: ["Dubai real estate", "Dubai rent drops", "Dubai price deals", "DXB property", "Dubai rental market 2026"],
  openGraph: {
    title: "DXB Dip",
    description: "Track Dubai rental price drops below pre-war averages. Real-time listings ranked by biggest savings.",
    siteName: "DXB Dip",
    locale: "en_AE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DXB Dip",
    description: "Track Dubai rental price drops below pre-war averages. Real-time listings ranked by biggest savings.",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${ibmPlexMono.variable} bg-background text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
