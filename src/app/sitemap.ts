import type { MetadataRoute } from "next";

const BASE_URL = "https://paytochat.fun";

/**
 * Sitemap covers the static, indexable surface only. Public profile
 * pages at `/[handle]` are intentionally NOT enumerated here — there's
 * no business case for surfacing every user to Google, and listing them
 * would let crawlers discover handle-uniqueness collisions. Profiles
 * are still individually crawlable when linked from elsewhere.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${BASE_URL}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${BASE_URL}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
