import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { pickLocale } from '@/lib/request-locale-pure'

// Explicit static imports so webpack/turbopack can trace both files at build time.
// Template-literal dynamic imports are not statically analysable and can silently
// fall back to the default locale in some Next.js build configurations.
async function loadMessages(locale: 'en' | 'fr') {
  if (locale === 'fr') return (await import('../../messages/fr.json')).default
  return (await import('../../messages/en.json')).default
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const headerStore = await headers()

  // Same precedence as every AI route (lib/request-locale-pure.ts): cookie → Accept-Language → en.
  const locale = pickLocale({ cookie: cookieStore.get('termlift_lang')?.value, acceptLanguage: headerStore.get('accept-language') })
  return {
    locale,
    messages: await loadMessages(locale),
  }
})
