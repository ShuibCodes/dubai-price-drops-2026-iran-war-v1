import { DM_Sans, IBM_Plex_Mono } from "next/font/google";
import Script from "next/script";
import { SHARE_IMAGE } from "@/lib/share-image";
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
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://agentzero.ae"),
  title: "AgentZero",
  description: "UAE's fastest growing Real Estate AI companion",
  keywords: ["Dubai real estate", "Dubai sales prices", "pre-war vs post-war", "DXB property sales", "Dubai market transparency"],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    title: "AgentZero",
    description: "UAE's fastest growing Real Estate AI companion",
    siteName: "AgentZero",
    locale: "en_AE",
    type: "website",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary",
    title: "AgentZero",
    description: "UAE's fastest growing Real Estate AI companion",
    images: [SHARE_IMAGE.url],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Queues goal events fired before the DataFast script finishes loading. */}
        <script
          id="datafast-queue"
          dangerouslySetInnerHTML={{
            __html:
              "window.datafast=window.datafast||function(){(window.datafast.q=window.datafast.q||[]).push(arguments)};",
          }}
        />
      </head>
      <body
        className={`${dmSans.variable} ${ibmPlexMono.variable} bg-background text-foreground antialiased`}
      >
        {children}
        <Script
          defer
          data-website-id="dfid_aqzPmo9l06RAI6kjno3Ok"
          data-domain="agentzero.ae"
          src="https://datafa.st/js/script.js"
        />
      </body>
    </html>
  );
}
