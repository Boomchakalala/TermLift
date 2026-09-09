import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Allow preview URLs for development
  allowedDevOrigins: ['preview-biyuzibqkmay.share.sandbox.dev'],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Exclude pdf-parse from bundling to prevent test code execution
  serverExternalPackages: ['pdf-parse', 'canvas'],

  async redirects() {
    return [
      { source: '/example', destination: '/demo', permanent: true },
      { source: '/example/:path*', destination: '/demo/:path*', permanent: true },
      // Retired blog posts (2026-09): off-topic for the SaaS / IT / marketing audience.
      { source: '/blog/how-to-negotiate-car-purchase', destination: '/blog', permanent: true },
      { source: '/blog/what-to-check-before-signing-equipment-lease', destination: '/blog', permanent: true },
    ]
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          // Scripts run from our origin and PostHog only; the app talks to Supabase, PostHog and Anthropic-free
          // (all AI calls are server-side). Stripe Checkout is a full-page redirect, so no Stripe script is needed.
          // 'unsafe-inline' for scripts is required by Next.js's inline bootstrap without a nonce setup.
          { key: 'Content-Security-Policy', value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://*.posthog.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self' data:",
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com",
            "worker-src 'self' blob:",
            "frame-src 'none'",
            "frame-ancestors 'none'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self' https://checkout.stripe.com",
            'upgrade-insecure-requests',
          ].join('; ') },
        ],
      },
    ]
  },
};

export default withNextIntl(nextConfig);
