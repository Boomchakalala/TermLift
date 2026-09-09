import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { I18nProvider } from "@/i18n/context";
import { CookieConsent } from "@/components/CookieConsent";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Redesign type system: Sora for display, JetBrains Mono for tiny labels only.
// Loaded through next/font (self-hosted, no layout shift) instead of the old
// Google Fonts <link>, which also pulled DM Sans that nothing uses any more.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "TermLift — Every vendor quote, negotiated",
    template: "%s | TermLift",
  },
  description: "Paste a supplier quote. In a couple of minutes you get a score, the red flags and a savings number. Then TermLift builds your Negotiation Playbook, writes the emails, or runs the whole negotiation for you.",
  metadataBase: new URL("https://www.termlift.com"),
  icons: {
    icon: "/favicon.png",
    apple: "/icon-512.png",
  },
  openGraph: {
    type: "website",
    siteName: "TermLift",
    title: "TermLift — Every vendor quote, negotiated",
    description: "Paste a supplier quote and get a score, the red flags and a savings number in minutes. Then get the Negotiation Playbook, or have TermLift negotiate for you.",
    url: "https://www.termlift.com",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TermLift — Every vendor quote, negotiated",
    description: "Paste a supplier quote and get a score, the red flags and a savings number in minutes. Then get the Negotiation Playbook, or have TermLift negotiate for you.",
  },
  alternates: {
    canonical: "https://www.termlift.com",
    languages: {
      en: "https://www.termlift.com",
      fr: "https://www.termlift.com",
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <head>
        <meta name="google-site-verification" content="VFAqvJkNGlWXSZLe4dtSN8benH7O0vTRBDzrrOyCX5E" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify([
              {
                "@context": "https://schema.org",
                "@type": "SoftwareApplication",
                name: "TermLift",
                applicationCategory: "BusinessApplication",
                description: "Paste a supplier quote and get a score, the red flags and a savings number in minutes. Then get the Negotiation Playbook, or have TermLift negotiate for you.",
                url: "https://www.termlift.com",
                offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
                operatingSystem: "Web",
              },
              {
                "@context": "https://schema.org",
                "@type": "Organization",
                name: "TermLift",
                url: "https://www.termlift.com",
                logo: "https://www.termlift.com/logo-icon.png",
                description: "Vendor quote analysis and a done-for-you negotiation service for SaaS, IT and marketing spend. Free Quick Analysis, a per-deal Negotiation Playbook, or TermLift negotiates for a success fee.",
                sameAs: [],
                contactPoint: {
                  "@type": "ContactPoint",
                  email: "hello@termlift.com",
                  contactType: "customer support",
                },
              },
            ]),
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sora.variable} ${jetbrains.variable} antialiased`}
      >
        <NextIntlClientProvider messages={messages}>
          <I18nProvider>
            <AnalyticsProvider>
              <Toaster position="top-right" richColors />
              {children}
              <CookieConsent />
            </AnalyticsProvider>
          </I18nProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
