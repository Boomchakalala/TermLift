// Currency conversion utility using exchangerate-api.io

const EXCHANGE_API_KEY = process.env.EXCHANGE_RATE_API_KEY || 'free'
const EXCHANGE_API_URL = 'https://open.er-api.com/v6/latest'

interface ExchangeRates {
  rates: Record<string, number>
  base: string
  time_last_update_unix: number
}

// Module-level cache (warm within the same serverless instance)
let ratesCache: ExchangeRates | null = null
let cacheTimestamp = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000

export const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'] as const
export type Currency = typeof SUPPORTED_CURRENCIES[number]

export const CURRENCY_LABELS: Record<Currency, string> = {
  EUR: '€ EUR — Euro',
  USD: '$ USD — US Dollar',
  GBP: '£ GBP — British Pound',
  CAD: 'C$ CAD — Canadian Dollar',
  AUD: 'A$ AUD — Australian Dollar',
  CHF: 'CHF — Swiss Franc',
  JPY: '¥ JPY — Japanese Yen',
}

/**
 * Detect currency from a string like "$15,000" or "€14,200" or "£10,000"
 */
export function detectCurrency(text: string): Currency {
  if (!text) return 'EUR'

  const upper = text.toUpperCase()

  // Check for explicit currency codes
  if (upper.includes('EUR') || text.includes('€')) return 'EUR'
  if (upper.includes('GBP') || text.includes('£')) return 'GBP'
  if (upper.includes('CAD') || upper.includes('C$')) return 'CAD'
  if (upper.includes('AUD') || upper.includes('A$')) return 'AUD'
  if (upper.includes('CHF')) return 'CHF'
  if (upper.includes('JPY') || text.includes('¥')) return 'JPY'
  if (upper.includes('USD') || text.includes('$')) return 'USD'

  // Default to EUR
  return 'EUR'
}

/**
 * Fetch latest exchange rates from API
 */
export async function fetchRates(): Promise<ExchangeRates> {
  const now = Date.now()

  // Return cached rates if still valid
  if (ratesCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return ratesCache
  }

  try {
    // next.revalidate persists the response in Next.js Data Cache across serverless cold starts.
    // One rate per day: every page converts with the same number until the next refresh.
    const response = await fetch(`${EXCHANGE_API_URL}/USD`, { next: { revalidate: 86400 } })
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rates')
    }

    const data = await response.json()
    ratesCache = {
      rates: data.rates,
      base: data.base_code,
      time_last_update_unix: data.time_last_update_unix
    }
    cacheTimestamp = now

    return ratesCache
  } catch (error) {
    console.error('Currency API error:', error)

    // Fallback to approximate rates if API fails
    return {
      rates: {
        USD: 1,
        EUR: 0.92,
        GBP: 0.79,
        CAD: 1.36,
        AUD: 1.52,
        CHF: 0.88,
        JPY: 149.5,
      },
      base: 'USD',
      time_last_update_unix: now
    }
  }
}

/**
 * Convert amount from one currency to another
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: Currency,
  toCurrency: Currency
): Promise<number> {
  if (fromCurrency === toCurrency) return amount

  const rates = await fetchRates()

  // Convert to USD first (base), then to target currency
  const usdAmount = fromCurrency === 'USD'
    ? amount
    : amount / rates.rates[fromCurrency]

  const targetAmount = toCurrency === 'USD'
    ? usdAmount
    : usdAmount * rates.rates[toCurrency]

  return Math.round(targetAmount * 100) / 100 // Round to 2 decimals
}

/**
 * Format currency amount with symbol
 * Shows actual numbers with commas for better precision
 */
export function formatCurrency(amount: number, currency: Currency): string {
  const symbols: Record<Currency, string> = {
    EUR: '€',
    USD: '$',
    GBP: '£',
    CAD: 'C$',
    AUD: 'A$',
    CHF: 'CHF ',
    JPY: '¥',
  }

  const symbol = symbols[currency]
  const noDecimals = currency === 'JPY'

  // For millions, use M notation
  if (amount >= 1000000) {
    return `${symbol}${(amount / 1000000).toFixed(1)}M`
  }

  // For amounts over 1,000 — round to whole numbers
  if (amount >= 1000) {
    const rounded = Math.round(amount)
    return `${symbol}${rounded.toLocaleString('en-US')}`
  }

  // For small amounts — show 2 decimals only if fractional (except JPY)
  if (noDecimals || Number.isInteger(amount)) {
    return `${symbol}${Math.round(amount).toLocaleString('en-US')}`
  }

  return `${symbol}${amount.toFixed(2)}`
}

/**
 * Normalize a raw currency string from AI output into consistent format.
 * Handles: "21 456,00 €", "40 998€", "$16,328.40", "€110,170", "15 000 €/an"
 * Returns: "€21,456", "$16,328", etc. (symbol before, comma thousands, no decimals)
 */
export function normalizeAmount(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw

  // Detect currency
  const currency = detectCurrency(raw)
  const symbols: Record<Currency, string> = {
    EUR: '€', USD: '$', GBP: '£', CAD: 'C$', AUD: 'A$', CHF: 'CHF ', JPY: '¥',
  }
  const symbol = symbols[currency]

  // Strip currency symbols, text suffixes, and spaces (spaces = thousands separator)
  let cleaned = raw
    .replace(/€|EUR|\$|USD|£|GBP|C\$|CAD|A\$|AUD|CHF|¥|JPY/gi, '')
    .replace(/\/(an|year|yr|month|mo|mois)/gi, '')
    .replace(/\s/g, '')
    .trim()

  // Keep only digits, dots, commas
  cleaned = cleaned.replace(/[^\d.,]/g, '')

  // Resolve thousands vs decimal separators.
  // Rule: when both '.' and ',' appear, the RIGHTMOST one is the decimal separator.
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')

  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) {
      // European: "55.085,00" → dots are thousands, comma is decimal
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    } else {
      // US: "55,085.00" → commas are thousands
      cleaned = cleaned.replace(/,/g, '')
    }
  } else if (lastComma >= 0) {
    const commaCount = (cleaned.match(/,/g) || []).length
    const afterComma = cleaned.length - lastComma - 1
    // A single comma with exactly 2 trailing digits is a decimal ("55085,00"); else thousands
    cleaned = (commaCount === 1 && afterComma === 2)
      ? cleaned.replace(',', '.')
      : cleaned.replace(/,/g, '')
  } else if (lastDot >= 0) {
    const dotCount = (cleaned.match(/\./g) || []).length
    const afterDot = cleaned.length - lastDot - 1
    // Multiple dots, or a single dot with 3 trailing digits ("55.085"), = thousands separators.
    // A single dot with 1-2 trailing digits ("1.50") is a genuine decimal — leave it.
    if (dotCount > 1 || afterDot === 3) {
      cleaned = cleaned.replace(/\./g, '')
    }
  }

  const num = parseFloat(cleaned)
  if (isNaN(num)) return raw // Can't parse, return original

  // Format: symbol + number with commas, no decimals for amounts >= 1
  if (num >= 1000000) {
    return `${symbol}${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1) {
    return `${symbol}${Math.round(num).toLocaleString('en-US')}`
  }
  return `${symbol}${num.toFixed(2)}`
}

/**
 * Parse money string and return amount + currency
 */
export function parseMoney(str: string): { amount: number; currency: Currency } {
  if (!str || typeof str !== 'string') {
    return { amount: 0, currency: 'EUR' }
  }

  // If it's a raw number, return directly
  if (typeof (str as any) === 'number') {
    return { amount: str as any, currency: 'EUR' }
  }

  const currency = detectCurrency(str)

  // Handle K/M suffixes first
  const kmMatch = str.match(/([\d.,\s]+)\s*([KkMm])/)
  if (kmMatch) {
    const num = parseFloat(kmMatch[1].replace(/[\s,]/g, ''))
    if (!isNaN(num)) {
      if (kmMatch[2].toUpperCase() === 'K') return { amount: num * 1000, currency }
      if (kmMatch[2].toUpperCase() === 'M') return { amount: num * 1000000, currency }
    }
  }

  // Strip currency symbols and text suffixes
  let cleaned = str
    .replace(/[€$£¥]/g, '')
    .replace(/USD|EUR|GBP|CAD|AUD|CHF|JPY/gi, '')
    .replace(/saved|économisés?|potentiel|per year|\/year|\/yr|\/an|\/month|\/mo|over contract life|monthly|annual|contract/gi, '')
    .trim()

  // Handle ranges: take midpoint
  const rangeMatch = cleaned.match(/([\d.,\s]+)[-–—]\s*([\d.,\s]+)/)
  if (rangeMatch) {
    const a = parseCleanNumber(rangeMatch[1])
    const b = parseCleanNumber(rangeMatch[2])
    if (a > 0 && b > 0) return { amount: (a + b) / 2, currency }
  }

  const amount = parseCleanNumber(cleaned)
  return { amount, currency }
}

/** Parse a number string handling both US (1,000.50) and European (1.000,50 or 1 000) formats */
function parseCleanNumber(str: string): number {
  let cleaned = str.trim()

  // Remove spaces (French thousands: "77 599")
  cleaned = cleaned.replace(/\s/g, '')

  // Detect European format: "4.200" (dot as thousands) vs "4.20" (dot as decimal)
  // European: digits.3digits with no other decimal = dot is thousands separator
  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '') // dots are thousands separators
  }
  // "77.599,50" = European with decimal comma
  if (/,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  }

  // Standard: strip commas (thousands separators in US format)
  cleaned = cleaned.replace(/,/g, '')

  // Remove any remaining non-numeric chars
  cleaned = cleaned.replace(/[^\d.]/g, '')

  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}
