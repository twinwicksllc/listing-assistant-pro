# Video Frame Extraction Plan

## Goal

Enable AI item identification when a user uploads only video by extracting a small, high-quality set of representative frames and sending those frames through the existing `analyze-item` image pipeline.

## Current State

- Video upload exists for eBay listing media via `VideoUploadInput` and `ebay-publish` video actions.
- Item identification currently expects images (`images` payload in `analyze-item`).
- Capture flow now supports a clear video-first entry path but does not yet extract frames for AI analysis.

## Target Flow

1. User uploads a video on Analyze (video-only path).
2. Frontend calls a new edge function action: `extract_video_frames`.
3. Edge function downloads the video from storage, extracts key frames, filters duplicates/blurry frames, and uploads selected frames to storage.
4. Edge function returns frame URLs (and optional base64 previews).
5. Frontend calls existing `analyze-item` with extracted frame images.

## Proposed API Contract

### New edge function

- Path: `supabase/functions/video-frame-extract/index.ts`
- Method: POST
- Input:

```json
{
  "videoUrl": "https://...",
  "maxFrames": 8,
  "strategy": "scene_change"
}
```

- Output:

```json
{
  "frames": [
    { "url": "https://.../frame-1.jpg", "timestampSec": 0.8, "score": 0.91 },
    { "url": "https://.../frame-2.jpg", "timestampSec": 2.4, "score": 0.88 }
  ],
  "meta": {
    "durationSec": 11.2,
    "framesExamined": 40,
    "framesSelected": 6
  }
}
```

## Extraction Strategy

1. Decode at low FPS sample rate (for example 2 FPS).
2. Compute frame quality score:

- sharpness (variance of Laplacian)
- brightness range
- duplicate distance (perceptual hash)

3. Keep top-N frames spread across timeline windows.
4. Ensure at least one frame from start/middle/end.
5. Clamp returned frames to 5-8 total.

## Backend Implementation Notes

- Runtime: Deno edge function.
- Processing tool: ffmpeg via a worker service or dedicated processing container.
- If ffmpeg is not available in edge runtime, use async job pattern:
  - edge function enqueues job
  - worker extracts frames
  - edge function/poller returns status
- Store extracted frames in `listing-images/listing-video-frames/<userId>/<videoId>/...`.

## Frontend Changes

1. AnalyzePage video-only mode:

- Add `Extract Frames for AI` button.
- Show progress and selected frame thumbnails.

2. On success:

- set `imageUrls` to extracted frame URLs (temporary in state).
- trigger existing `handleGenerate()` pipeline.

## Safety and Cost Controls

- Max video duration for extraction (for example 30s initially).
- Max file size gate and early rejection message.
- Hard cap on output frames.
- Cache extraction results by video hash.

## Rollout Plan

### Slice 1

- Add edge function scaffold + mocked output.
- Wire AnalyzePage `Extract Frames for AI` button to mocked response.

### Slice 2

- Implement real extraction worker and frame quality filtering.
- Persist frames and return URLs.

### Slice 3

- End-to-end integration with `analyze-item` using extracted frames.
- Add telemetry and failure fallbacks.

## Success Criteria

- User can upload only video and still generate listing identification.
- At least 90% of video-only attempts produce usable extracted frames.
- No regression to existing photo-first analysis flow.
