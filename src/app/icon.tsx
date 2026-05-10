import { ImageResponse } from "next/og";

// Pinned for Next.js metadata; route is statically optimized at build time.
export const runtime = "edge";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Auto-generated favicon. Mirrors the in-app `<Logo>` mark: a soft
 * purple-violet gradient square with a bold white "$" glyph. Kept
 * intentionally simple so it stays legible at 16px (browser tab) /
 * 32px (bookmarks list / SERP).
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 22,
          fontWeight: 900,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          background:
            "linear-gradient(135deg, #7c5cff 0%, #b79afa 100%)",
          borderRadius: 7,
        }}
      >
        $
      </div>
    ),
    { ...size }
  );
}
