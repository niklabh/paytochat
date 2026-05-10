import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * iOS home-screen icon (180×180). Same gradient + glyph as the favicon,
 * with the small emerald "online" dot from the in-app `<Logo>` to keep
 * the mark recognisable at larger sizes. iOS will mask this to the
 * platform's rounded-rectangle silhouette automatically.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(135deg, #7c5cff 0%, #b79afa 100%)",
          position: "relative",
        }}
      >
        <div
          style={{
            color: "white",
            fontSize: 120,
            fontWeight: 900,
            lineHeight: 1,
            fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
            display: "flex",
          }}
        >
          $
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 22,
            right: 22,
            width: 28,
            height: 28,
            borderRadius: 999,
            background: "#34d399",
            border: "5px solid #0b0b10",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size }
  );
}
