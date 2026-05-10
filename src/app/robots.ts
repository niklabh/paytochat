import type { MetadataRoute } from "next";

const BASE_URL = "https://paytochat.fun";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Marketing surface (`/`) and public profiles (`/[handle]`) are
        // crawlable. Anything inside the authenticated app or behind an
        // API endpoint is not — there's nothing useful to index there
        // and we'd rather not have unauthenticated bots probe Firestore.
        allow: ["/"],
        disallow: ["/a/", "/api/"],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  };
}
