# Video Frame Extraction — Remaining Work Plan

## Context

Video attachment to eBay listings (record/upload, max 10s, eBay Video API upload, publish attachment) is complete — see `src/components/VideoUploadInput.tsx` and the `upload_video`/`get_video_status`/`create_draft` actions in `supabase/functions/ebay-publish/index.ts`.

Frame extraction for AI identification on video-only submissions (`src/hooks/useVideoFrameExtraction.ts`, `supabase/functions/video-frame-extract/index.ts`, `src/components/analyze/VideoOnlyView.tsx`) is partially built. This plan tracks what's left to make it production-ready.

## Gaps and Plan

### 1. Fake fallback frames are unusable for AI analysis

**Problem:** `video-frame-extract/index.ts`'s `makeMockFrameDataUrl()` returns placeholder SVGs with literal text ("Mock extracted frame") when no client frames are supplied. The "Use Fallback Frame Set" button in `VideoOnlyView.tsx` wires directly to this mock path, so a user who hits a CORS/extraction failure and clicks fallback would run AI identification against fake images.

**Plan:**

- Remove the mock-image fallback from the user-facing retry path.
- Replace "Use Fallback Frame Set" with either:
  - a retry of client-side extraction with adjusted parameters (lower frame count, different sampling window), or
  - a clear redirect to "Use Photo Capture Instead" (already present as a second button) as the primary recovery path.
- Keep `makeMockFrameDataUrl()` only for local/dev testing of the edge function contract, gated behind an explicit `debug` flag, never reachable from production UI.

### 2. No real frame-quality scoring

**Problem:** Frames are sampled at fixed, evenly-spaced timestamps with a fabricated `score` (`0.96 - i*0.03`). There is no sharpness, brightness, or duplicate-frame filtering as originally scoped.

**Plan:**

- Add a lightweight client-side quality pass in `extractFramesClientSide()`:
  - Compute a sharpness proxy (variance of luminance gradient) per candidate frame via canvas pixel sampling.
  - Drop frames below a minimum sharpness threshold and re-sample nearby timestamps.
  - Compute a simple perceptual-hash-style distance between consecutive frames to drop near-duplicates.
- Replace the fabricated `score` field with the real computed sharpness score.

### 3. No server-side extraction fallback

**Problem:** `video-frame-extract/index.ts` only persists frames the client already captured — there is no true server-side (ffmpeg/worker) extraction path for browsers/devices where canvas-based capture fails (e.g., unsupported codec, Safari metadata quirks).

**Plan:**

- Short-term: rely on the client extraction + "Use Photo Capture Instead" recovery (per #1), and log failures via existing telemetry to quantify how often this is actually needed.
- Longer-term (only if telemetry shows meaningful failure rate): stand up a dedicated worker/container with ffmpeg, with the edge function enqueuing a job and polling for completion, matching the original async job pattern in `docs/VIDEO_FRAME_EXTRACTION_PLAN.md`.

### 4. Storage CORS not verified

**Problem:** Client-side canvas frame capture requires `crossOrigin="anonymous"` video loads to succeed without tainting the canvas, which depends on the `listing-images` Supabase Storage bucket serving correct CORS headers. This has not been operationally verified.

**Plan:**

- Verify bucket CORS configuration in the Supabase dashboard (allowed origins include production + preview domains).
- Add a smoke test (manual or Playwright) that uploads a video, extracts frames, and confirms no `cors_tainted_canvas` error path is hit in a real deployed environment.

### 5. No success-rate validation

**Problem:** The original plan's success criterion ("≥90% of video-only attempts produce usable extracted frames") has never been measured.

**Plan:**

- Use the existing telemetry log (`video-frame-extract telemetry` console log in the edge function) to build a simple query/dashboard on `source`, `reason`, and `mocked` fields.
- Track this for at least one deployment cycle before considering frame extraction "done."

### 6. eBay video + auction-format interaction unverified

**Problem:** `types/listing.ts` notes eBay video support is "FIXED_PRICE only," but no code path actually gates video upload/attachment by `listingFormat`. Behavior for `AUCTION` listings with an attached video has not been confirmed against eBay's API.

**Plan:**

- Test publishing an `AUCTION` listing with a `LIVE` video attached against the eBay sandbox/production API.
- If eBay rejects it, either hide the video uploader when `listingFormat === "AUCTION"` or strip `ebayVideoId` from the payload for auction listings, with a clear inline message explaining why.

## Suggested Order of Work

1. #1 (fallback safety) — prevents shipping a footgun, small change.
2. #6 (auction interaction) — cheap to verify, avoids silent publish failures.
3. #4 (CORS verification) — operational check, unblocks reliable client extraction.
4. #2 (real quality scoring) — meaningful quality improvement, moderate effort.
5. #5 (success-rate measurement) — ongoing, informs whether #3 is needed.
6. #3 (server-side fallback) — only pursue if #5 shows a real gap.
