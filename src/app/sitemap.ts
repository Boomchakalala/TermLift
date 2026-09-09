import type { MetadataRoute } from 'next'
import { getAllPosts } from '@/lib/blog'

/**
 * Generated sitemap (served at /sitemap.xml). Blog posts come from the post
 * registry, so a new article is listed the moment it ships. French is served
 * on the same URLs by cookie, so there are no hreflang alternates to declare.
 */
const BASE = 'https://www.termlift.com'

const STATIC: Array<[path: string, priority: number, changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']]> = [
  ['', 1, 'weekly'],
  ['/pricing', 0.9, 'monthly'],
  ['/blog', 0.8, 'weekly'],
  ['/demo', 0.8, 'monthly'],
  ['/negotiate', 0.8, 'monthly'],
  ['/help', 0.6, 'monthly'],
  ['/about', 0.5, 'yearly'],
  ['/security', 0.5, 'yearly'],
  ['/contact', 0.4, 'yearly'],
  ['/privacy', 0.2, 'yearly'],
  ['/terms', 0.2, 'yearly'],
]

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: MetadataRoute.Sitemap = STATIC.map(([path, priority, changeFrequency]) => ({ url: `${BASE}${path}`, priority, changeFrequency }))
  const posts: MetadataRoute.Sitemap = getAllPosts('en').map((p) => ({
    url: `${BASE}/blog/${p.slug}`,
    lastModified: new Date(p.date),
    changeFrequency: 'monthly',
    priority: 0.7,
  }))
  return [...pages, ...posts]
}
