import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * 512×512 PNG used by `manifest.ts` for Android home-screen install /
 * Lighthouse's PWA audit. We declare `purpose: "maskable"` in the
 * manifest, which means Android may crop a circular / squircle mask out
 * of this image — so the gradient backing extends edge-to-edge and the
 * "$" + status-dot live inside the safe zone (≥ 10% inset).
 */
export async function GET() {
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
            fontSize: 320,
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
            bottom: 90,
            right: 90,
            width: 78,
            height: 78,
            borderRadius: 999,
            background: "#34d399",
            border: "12px solid #0b0b10",
            display: "flex",
          }}
        />
      </div>
    ),
    { width: 512, height: 512 }
  );
}
