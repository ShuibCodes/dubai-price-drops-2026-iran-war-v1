import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "AgentZero",
  description: "UAE's fastest growing Real Estate AI companion",
  keywords: ["Dubai real estate", "Dubai sales prices", "pre-war vs post-war", "DXB property sales", "Dubai market transparency"],
  openGraph: {
    title: "AgentZero",
    description: "UAE's fastest growing Real Estate AI companion",
    siteName: "AgentZero",
    locale: "en_AE",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentZero",
    description: "UAE's fastest growing Real Estate AI companion",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${ibmPlexMono.variable} bg-background text-foreground antialiased`}
      >
        {children}
        <Script
          src="https://datafa.st/js/script.js"
          strategy="afterInteractive"
          data-website-id="dfid_aqzPmo9l06RAI6kjno3Ok"
          data-domain="thedxbdip.com"
        />
      </body>
    </html>
  );
}
