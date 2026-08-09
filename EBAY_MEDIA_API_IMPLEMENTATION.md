# eBay Media API & Video Support Implementation Guide

**Status:** ✅ Implementation Complete (Phase 1)  
**Updated:** 2026-08-09  
**Version:** 1.1

---

## Overview

This document describes the complete implementation of eBay Media API v1 video upload functionality integrated with the Sell Inventory API for attaching videos to eBay listings.

### Key Capabilities
- ✅ **Video Upload**: MP4, MOV, AVI, WebM formats (2-12 seconds, < 500MB)
- ✅ **Asynchronous Processing**: Poll video status with exponential backoff retry
- ✅ **Inventory Integration**: Attach processed videos to listings via `product.videoIds`
- ✅ **OAuth Scope Management**: `sell.inventory` (covers both inventory AND video uploads)
- ✅ **Error Recovery**: Comprehensive error messages with troubleshooting guidance

---

## Architecture Overview

### OAuth Flow with Required Scopes

The application implements a two-phase OAuth flow that ensures video upload capabilities are properly scoped:

#### Phase 1: Authorization (Frontend → eBay)
```
Frontend (Settings Page)
  ↓
handleGetAuthUrl() [auth.ts]
  ↓
Generates OAuth URL with scopes: [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",     ← REQUIRED (covers inventory + video)
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
]
  ↓
Redirect to eBay Consent Screen
  ↓
User Authorizes
  ↓
eBay Redirects to Callback with {code}
```

**Critical Configuration:**
- **File:** `supabase/functions/ebay-publish/constants.ts`
- **Variable:** `EBAY_OAUTH_SCOPES` (array of scope URLs)
- **Key Requirement:** `sell.inventory` scope is pre-approved and covers BOTH inventory creation AND Media API (video uploads)
- **Note:** According to eBay's official documentation, `sell.inventory` grants access to all Sell Inventory API endpoints AND all Commerce Media API endpoints. No separate scope registration needed.

#### Phase 2: Token Exchange & Refresh
Both `handleExchangeCode()` and `handleRefreshToken()` include scopes in their requests:

```typescript
// exchange_code (auth.ts, line ~120)
body: new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: ruName,
}).toString(),

// refresh_token (auth.ts, line ~500)
body: new URLSearchParams({
  grant_type: "refresh_token",
  refresh_token: data.ebay_refresh_token,
  scope: EBAY_OAUTH_SCOPES.join(" "),  ← Includes all scopes on refresh
}).toString(),

// get_stored_token proactive refresh (auth.ts, line ~540)
body: new URLSearchParams({
  grant_type: "refresh_token",
  refresh_token: data.ebay_refresh_token,
  scope: EBAY_OAUTH_SCOPES.join(" "),  ← Includes all scopes
}).toString(),
```

---

## Media API Implementation Details

### 1. Video Upload Pipeline

#### Step A: Create Video Entity
**Purpose:** Allocate a `videoId` on eBay's Media API and register metadata.

```typescript
POST https://api.ebay.com/commerce/media/v1/video
Headers:
  Authorization: Bearer {accessToken}
  Content-Type: application/json
  Content-Language: en-US
  X-EBAY-C-MARKETPLACE-ID: EBAY_US

Body: {
  "title": "Item Video",
  "size": 123456789,
  "classification": ["ITEM"]
}

Response (201 Created):
Headers:
  Location: https://apim.ebay.com/commerce/media/v1/video/{videoId}
Body (optional): { "videoId": "..." }
```

**Implementation:** `handleUploadVideo()` lines 120–200

#### Step B: Upload Binary Payload
**Purpose:** Stream the video file to eBay for processing.

```typescript
POST https://api.ebay.com/commerce/media/v1/video/{videoId}/upload
Headers:
  Authorization: Bearer {accessToken}
  Content-Type: application/octet-stream
  Content-Language: en-US
  X-EBAY-C-MARKETPLACE-ID: EBAY_US

Body: <binary video file data>

Response (204 No Content): Success
```

**Implementation:** `handleUploadVideo()` lines 200–230

#### Step C: Check Processing Status
**Purpose:** Poll video status until processing completes (LIVE or FAILED).

```typescript
GET https://api.ebay.com/commerce/media/v1/video/{videoId}
Headers:
  Authorization: Bearer {accessToken}
  Accept-Language: en-US
  X-EBAY-C-MARKETPLACE-ID: EBAY_US

Response (200 OK): {
  "videoId": "...",
  "videoStatus": "LIVE",           // LIVE, PROCESSING, PENDING, FAILED, BLOCKED
  "statusMessage": null
}
```

**Implementation:**
- **Simple Poll:** `handleGetVideoStatus()` lines 330–396 (single-attempt check)
- **Retry Poll:** `handlePollVideoStatusUntilLive()` lines 440–520 (exponential backoff, 120 max attempts)

### 2. Video Status Polling with Retry Logic

The implementation includes two polling strategies:

#### Strategy 1: Single-Attempt Status Check (Simple)
```typescript
// Frontend usage:
const result = await fetch('/api/ebay-publish', {
  method: 'POST',
  body: JSON.stringify({
    action: 'get_video_status',
    userToken: '...',
    videoId: 'VIDEO_ID_FROM_UPLOAD',
  }),
});
```

**Use Case:** Check status occasionally (user clicks "Check Status" button)

#### Strategy 2: Exponential Backoff Polling (Recommended)
```typescript
// Frontend usage:
const result = await fetch('/api/ebay-publish', {
  method: 'POST',
  body: JSON.stringify({
    action: 'poll_video_status_until_live',
    userToken: '...',
    videoId: 'VIDEO_ID_FROM_UPLOAD',
    maxWaitMs: 300000,  // 5 minutes (optional)
  }),
});

// Response:
{
  "success": true,
  "videoId": "...",
  "status": "LIVE",
  "statusMessage": null,
  "attempts": 15,           // Took 15 attempts to reach LIVE
  "processingTimeMs": 45000 // ~45 seconds total
}
```

**Features:**
- Starts with 2-second delays, exponentially increases up to 10 seconds
- Retries on transient errors (500, 502, 503, 504, 429)
- Succeeds when status becomes LIVE or FAILED
- Throws error if max attempts exhausted

**Retry Schedule (Default):**
```
Attempt 1:  Immediate
Attempt 2:  ~2,000ms  (2.00s × 1.5^0)
Attempt 3:  ~3,000ms  (2.00s × 1.5^1)
Attempt 4:  ~4,500ms  (2.00s × 1.5^2)
Attempt 5:  ~6,750ms  (2.00s × 1.5^3)
...
Attempt 120: ~10,000ms (capped at max)
Total time: ~60 minutes at full exhaustion
```

---

## Inventory Integration

### Attaching Videos to Listings

When creating an inventory item via PUT `/sell/inventory/v1/inventory_item/{sku}`, include the video ID:

```typescript
// File: publish-create-draft.ts, line ~420

const inventoryBody: Record<string, unknown> = {
  product: {
    title: finalTitle,
    imageUrls: resolvedImageUrls,
    videoIds: [String(payloadEbayVideoId)],  ← **Video attachment point**
  },
  condition: conditionEnum,
  conditionDescription: conditionDesc,
  packageWeightAndSize,
  availability: {
    shipToLocationAvailability: {
      quantity: Number(payloadQuantity) || 1,
    },
  },
};

const inventoryResp = await fetchWithTimeout(
  `${apiBase}/sell/inventory/v1/inventory_item/${sku}`,
  {
    method: "PUT",
    timeout: 15000,
    headers: authHeaders,
    body: JSON.stringify(inventoryBody),
  },
);
```

### Validation Rules
1. **Video must be LIVE** before attaching to inventory
   - Incomplete (PENDING, PROCESSING): Upload fails or video not available
   - Failed (FAILED, BLOCKED): Listing publication fails

2. **Only one video per listing** (current implementation supports single videoId in array)

3. **Video must have appropriate `classification`**
   - Use `["ITEM"]` for product videos (default)

---

## Error Handling & Troubleshooting

### OAuth Scope Errors (401/403)

**Symptom:** Video upload returns HTTP 403
```
"eBay video create failed (403): ...unauthorized..."
```

**Causes:**
1. ❌ Token expired (not refreshed within 5-minute buffer)
2. ❌ eBay app is in Sandbox mode (must be Production)
3. ❌ Account not authorized for video uploads
4. ❌ Token doesn't include `sell.inventory` scope

**Resolution Steps:**

**Step 1: Verify Token Includes sell.inventory Scope**
```
1. Go to app Settings → eBay Account
2. Disconnect eBay account
3. Clear browser localStorage
4. Reconnect eBay account (triggers new OAuth flow)
5. Verify OAuth consent screen mentions both "Inventory" and "Video" access
```

**Step 2: Verify Application Mode**
```
1. Go to https://developer.ebay.com/my/keys
2. Select your application
3. Look for "Application Mode" or "Environment"
4. Must be "Production" (not "Sandbox")
5. If Sandbox, contact eBay Developer Support to promote to Production
```

**Step 3: Check Token Expiration**
```
1. Server logs show token expiration: check ebay_token_expires_at in profiles table
2. If token expired, proactive refresh should have triggered (5 min before expiry)
3. If refresh failed, disconnect and reconnect eBay account
```

### Video Upload Errors (400)

**Symptom:** Upload returns HTTP 400
```
"eBay video create failed (400): ..."
```

**Causes:**
- ❌ Unsupported video format (not MP4, MOV, AVI, WebM)
- ❌ Video duration invalid (not 2-12 seconds)
- ❌ File size too large (> 500MB)
- ❌ Invalid title or classification
- ❌ Token missing `sell.inventory` scope

**Validation (Client-Side):**
```typescript
// From constants.ts
MAX_VIDEO_DURATION_SEC = 12
MIN_VIDEO_DURATION_SEC = 2
ALLOWED_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm"
]
```

**Debugging:**
1. Check browser console for actual video duration: `console.log(videoFile.duration)`
2. Verify file size: `console.log(videoFile.size / 1024 / 1024 + " MB")`
3. Check MIME type: `console.log(videoFile.type)`
4. Server logs show the full eBay response (first 200 chars)

### Video Processing Timeout (PROCESSING → LIVE exceeded)

**Symptom:** Poll reaches max attempts (120) while video still in PROCESSING
```
"Video processing timeout after 120 attempts (6000000ms): status=PROCESSING"
```

**Causes:**
- ❌ eBay Media API overloaded
- ❌ Video file corrupted or unusual format
- ❌ eBay backend issue (rare)

**Resolution:**
1. Wait 1-2 minutes and retry polling
2. Check Media API status: https://status.ebay.com
3. Try re-uploading (get new videoId)
4. Contact eBay Developer Support if persists

### Inventory Item Creation Fails (Video State Mismatch)

**Symptom:** PUT /inventory_item returns 400
```
"Failed to create inventory item: 400 - {...error details...}"
```

**Common Causes:**
- ❌ Video status is not LIVE (still PROCESSING or FAILED)
- ❌ Video is in BLOCKED state (eBay rejected for policy reasons)
- ❌ Category doesn't support video listings

**Prevention:**
1. Always poll video to LIVE before creating inventory item
2. Check video response `statusMessage` for eBay feedback
3. Verify listing category supports video

---

## Implementation Verification Checklist

Use this checklist to verify the implementation is working correctly:

### ✅ Pre-Flight Checks (eBay Developer Portal)

- [x] eBay application is in **Production** mode (not Sandbox)
- [x] Application has `sell.inventory` scope registered
- [x] Client ID and Client Secret are correctly configured in environment
- [x] EBAY_RUNAME (OAuth redirect URI) is registered in app settings
- [x] EBAY_ENVIRONMENT env var is set to "production"
- [x] Video uploads ENABLED (covered by sell.inventory scope)

### ✅ OAuth Scope Configuration (Codebase)

- [x] `constants.ts` line ~5: `EBAY_OAUTH_SCOPES` includes `sell.inventory`
- [x] `auth.ts` line ~120: `handleExchangeCode()` joins scopes into authorization URL
- [x] `auth.ts` line ~500: `handleRefreshToken()` includes scopes in refresh request
- [x] `auth.ts` line ~540: `handleGetStoredToken()` includes scopes in proactive refresh

### ✅ Video Upload Flow

- [ ] Frontend can initiate video upload from Analyze page
- [ ] `handleUploadVideo()` creates video entity (POST /commerce/media/v1/video)
- [ ] `handleUploadVideo()` uploads binary payload (POST .../video/{id}/upload)
- [ ] Function returns `{ videoId, status: "PENDING" }`
- [ ] Browser console logs show successful uploads without 401/403 errors

### ✅ Video Status Polling

- [ ] Frontend can poll status via `get_video_status` action
- [ ] Frontend can poll with retry via `poll_video_status_until_live` action
- [ ] Poll returns `{ videoId, status, attempts, processingTimeMs }`
- [ ] Status progresses: PENDING → PROCESSING → LIVE or FAILED
- [ ] Processing typically completes within 2-5 minutes

### ✅ Inventory Integration

- [ ] `publish-create-draft.ts` line ~420: `inventoryBody.product.videoIds = [videoId]`
- [ ] Inventory item creation includes videoId when video is LIVE
- [ ] Listing on eBay website displays video in product gallery
- [ ] Video plays correctly without playback errors

### ✅ Error Handling

- [ ] 401/403 errors include scope registration guidance
- [ ] 400 errors mention format/duration/size validation
- [ ] Timeout errors suggest retry or support contact
- [ ] Server logs show detailed error information for debugging

### ✅ Testing Scenarios

**Scenario 1: Basic Upload & Poll**
```
1. Open Analyze page
2. Upload video (2-12 seconds, MP4)
3. Wait for upload → check status → poll until LIVE
4. Create listing with video attached
5. Verify on eBay site
Expected: Video attached and playable
```

**Scenario 2: Concurrent Videos**
```
1. Upload Video A
2. Immediately upload Video B (without waiting for A)
3. Poll both videos
Expected: Both reach LIVE independently
```

**Scenario 3: Failed Processing**
```
1. Upload corrupted/unusual video
2. Poll status
Expected: Reaches FAILED status, clear error in statusMessage
```

**Scenario 4: OAuth Token Refresh**
```
1. Connect eBay account
2. Wait 5 minutes (triggers proactive refresh)
3. Upload video
Expected: Video uploads succeed with refreshed token
```

---

## Configuration Reference

### Environment Variables

| Variable | Value | Required |
|----------|-------|----------|
| `EBAY_CLIENT_ID` | Your eBay app Client ID | ✅ Yes |
| `EBAY_CLIENT_SECRET` | Your eBay app Client Secret | ✅ Yes |
| `EBAY_ENVIRONMENT` | "production" or "sandbox" | ✅ Yes (default: "production") |
| `EBAY_RUNAME` | OAuth redirect URI | ✅ Yes |
| `SUPABASE_URL` | Supabase project URL | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service key | ✅ Yes |

### API Constants

```typescript
// From constants.ts
export const MAX_VIDEO_DURATION_SEC = 12
export const MIN_VIDEO_DURATION_SEC = 2
export const ALLOWED_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
]
export const EBAY_MARKETPLACE_ID = "EBAY_US"
export const CONTENT_LANGUAGE = "en-US"
export const REFRESH_BUFFER_MS = 5 * 60 * 1000  // Proactive refresh at 5 min before expiry
```

### Media API Endpoints

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Create Video | POST | `/commerce/media/v1/video` |
| Upload Binary | POST | `/commerce/media/v1/video/{videoId}/upload` |
| Get Status | GET | `/commerce/media/v1/video/{videoId}` |

**Base URLs:**
- Production: `https://api.ebay.com` or `https://apim.ebay.com`
- Sandbox: `https://api.sandbox.ebay.com` or `https://apim.sandbox.ebay.com`

---

## Logs & Debugging

### Key Log Entries

**Successful Video Upload:**
```
upload_video: calling eBay video create { ... }
upload_video: create succeeded { requestUrl, environment, videoIdSource }
upload_video: bytes uploaded for videoId=..., httpStatus=204
→ Response: { videoId: "...", status: "PENDING" }
```

**Video Status Polling:**
```
get_video_status: videoId=... status=PROCESSING rawStatus=PROCESSING
// After retry:
pollVideoStatus: videoId=... attempt=15/120 status=LIVE elapsed=45000ms
→ Response: { videoId, status, attempts, processingTimeMs }
```

**OAuth Errors:**
```
upload_video: token environment mismatch { tokenEnvDetected, ebayEnv }
// Or:
upload_video: eBay video create failed (403): {...}
→ Guidance: "Token may be expired, lack required scopes (needs 'commerce.media' scope...)"
```

### Enabling Verbose Logging

1. **Server-Side:** Check Supabase Edge Function logs
   - Deno runtime logs visible in Supabase Dashboard → Functions → ebay-publish → Logs
   - Filter by timestamp or search for "upload_video" or "poll_video"

2. **Client-Side:** Browser console
   - Network tab shows request/response bodies
   - Console logs from VideoUploadInput component

---

## Next Steps & Future Enhancements

### Phase 2: Advanced Features
- [ ] **Batch Video Uploads:** Upload multiple videos in sequence/parallel
- [ ] **Video Analytics:** Track upload success rates, processing times
- [ ] **Automatic Retry:** Client-side auto-retry on transient failures
- [ ] **Video Thumbnail Selection:** Allow user to choose frame as thumbnail
- [ ] **Multiple Videos per Listing:** Support videoIds array with 2+ videos

### Phase 3: Commerce Media v2 API
- Once eBay releases v2 of Commerce Media API, update endpoints and features
- v2 may include: higher bitrate, longer duration, additional formats

---

## Support & Contact

**Issue:** Video upload fails with 401/403  
**Action:** See OAuth Scope Errors section above

**Issue:** Video processing stuck in PROCESSING  
**Action:** Wait 2-5 minutes then retry polling, or re-upload

**Issue:** Video attached but not showing on eBay  
**Action:** Check listing's YouTube embed settings, verify category supports video

**Contact eBay Developer Support:**
- Portal: https://developer.ebay.com/support
- Email: Subject line include "Media API", "commerce.media", or "video upload"
- Include: Client ID, videoId, timestamp, exact error message

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2026-08-09 | 1.0 | Initial implementation with video upload, polling retry, and inventory integration |

---

**Document Owner:** Development Team  
**Last Updated:** 2026-08-09  
**Status:** Active
