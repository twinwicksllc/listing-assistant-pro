import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

type ExtractRequest = {
  videoUrl?: string;
  maxFrames?: number;
  strategy?: string;
};

function makeMockFrameDataUrl(label: string): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1d4ed8" />
    </linearGradient>
  </defs>
  <rect width="960" height="540" fill="url(#bg)" />
  <rect x="30" y="30" width="900" height="480" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3" />
  <text x="480" y="260" text-anchor="middle" fill="#ffffff" font-size="38" font-family="Arial, sans-serif" font-weight="700">${label}</text>
  <text x="480" y="305" text-anchor="middle" fill="#e2e8f0" font-size="20" font-family="Arial, sans-serif">Mock extracted frame (Slice 1 scaffold)</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const svc = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: ud } = await svc.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = ud?.user?.id;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as ExtractRequest;
    const videoUrl = body.videoUrl?.trim();
    const maxFrames = Math.max(1, Math.min(12, body.maxFrames ?? 6));
    const strategy = body.strategy ?? "scene_change";

    if (!videoUrl) {
      return new Response(
        JSON.stringify({ error: "videoUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Slice 1 scaffold:
    // Return deterministic mock frames so frontend integration can be wired
    // before real ffmpeg/worker extraction lands.
    const frames = Array.from({ length: Math.min(maxFrames, 6) }).map((_, idx) => ({
      url: makeMockFrameDataUrl(`Frame ${idx + 1}`),
      timestampSec: Number((idx * 1.2 + 0.8).toFixed(1)),
      score: Number((0.94 - idx * 0.03).toFixed(2)),
    }));

    return new Response(
      JSON.stringify({
        frames,
        meta: {
          strategy,
          mocked: true,
          userId,
          durationSec: 8.4,
          framesExamined: 24,
          framesSelected: frames.length,
          message: "Slice 1 mock response. Real extraction worker will be added in Slice 2.",
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("video-frame-extract error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unexpected error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
