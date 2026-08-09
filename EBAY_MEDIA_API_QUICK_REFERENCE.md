# eBay Media API - Quick Reference Card

## 🚀 Video Upload Flow (Frontend to Backend)

```
1. User selects video file on Analyze page
2. Client validates: format, duration (2-12s), size
3. Frontend calls: POST /api/ebay-publish { action: "upload_video", videoUrl, ... }
4. Backend creates video entity, uploads bytes, returns videoId
5. Poll status until LIVE: POST /api/ebay-publish { action: "poll_video_status_until_live", videoId, ... }
6. Create inventory with video: POST /api/ebay-publish { action: "create_draft", ebayVideoId, ... }
```

---

## 🔐 OAuth Scope Requirements

| Scope | Required | Purpose |
|-------|----------|---------|
| `https://api.ebay.com/oauth/api_scope` | ✅ YES | Base authentication |
| `https://api.ebay.com/oauth/api_scope/sell.inventory` | ✅ YES | **Covers BOTH:** Create/update listings AND video uploads (Media API) |
| `https://api.ebay.com/oauth/api_scope/sell.account` | ✅ YES | Account access |
| `https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly` | ⚠️ OPTIONAL | Fulfillment data |

**Key Fact:** `sell.inventory` scope grants access to BOTH Sell Inventory API AND Commerce Media API (video uploads). No separate scope needed.

---

## 🎬 Supported Video Formats

| Format | MIME Type | Status |
|--------|-----------|--------|
| MP4 | video/mp4 | ✅ Recommended |
| MOV | video/quicktime | ✅ Supported |
| AVI | video/x-msvideo | ✅ Supported |
| WebM | video/webm | ✅ Supported |

**Duration:** 2–12 seconds  
**Max Size:** 500MB

---

## 📊 Video Status Lifecycle

```
PENDING ──upload bytes──→ PROCESSING ──eBay processes──→ LIVE (Success)
                                    └─errors─→ FAILED
                                           └─policy violation─→ BLOCKED
```

| Status | Meaning | Action |
|--------|---------|--------|
| PENDING | Uploaded, waiting to process | Poll to check progress |
| PROCESSING | eBay is validating/encoding | Continue polling |
| LIVE | Ready to attach to listings | Proceed with inventory creation |
| FAILED | Validation failed | Check statusMessage for details |
| BLOCKED | Policy violation detected | Re-upload with different content |

**Typical timeline:** PENDING → PROCESSING → LIVE in 2-5 minutes

---

## 📝 Edge Function Actions

### upload_video
```json
{
  "action": "upload_video",
  "userToken": "eBay access token",
  "videoUrl": "https://storage.../video.mp4",
  "title": "Item Video",
  "contentType": "video/mp4",
  "durationSec": 10,
  "fileSize": 5242880
}
```
**Returns:** `{ videoId, status: "PENDING" }`

### get_video_status (Single Check)
```json
{
  "action": "get_video_status",
  "userToken": "eBay access token",
  "videoId": "video ID from upload"
}
```
**Returns:** `{ videoId, status, statusMessage }`

### poll_video_status_until_live (Retry with Backoff)
```json
{
  "action": "poll_video_status_until_live",
  "userToken": "eBay access token",
  "videoId": "video ID from upload",
  "maxWaitMs": 300000
}
```
**Returns:** `{ success, videoId, status, attempts, processingTimeMs }`

### create_draft (Attach Video)
```json
{
  "action": "create_draft",
  "userToken": "eBay access token",
  "sku": "item SKU",
  "ebayVideoId": "videoId from poll",
  ...other listing fields...
}
```
**Returns:** Listing created with video attached

---

## ⚠️ Common Errors & Fixes

| Error | Status | Root Cause | Fix |
|-------|--------|-----------|-----|
| `invalid_scope` | 400 | Scope not registered with eBay | Register at Developer Portal |
| `unauthorized` | 401 | Token expired or missing | Reconnect eBay account |
| `access_denied` | 403 | Account lacks permissions | Verify eBay app is in Production |
| `PROCESSING timeout` | Timeout | Video stuck in processing | Retry after 2-5 min or re-upload |
| `Video not LIVE` | 400 | Video still processing when attaching | Wait for LIVE status before creating listing |

---

## 🔧 Configuration Checklist

**Already Configured:**

- [x] ✅ eBay app is in **Production** mode (not Sandbox)
- [x] ✅ `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` configured
- [x] ✅ `EBAY_RUNAME` (redirect URI) registered in app settings
- [x] ✅ `EBAY_ENVIRONMENT=production` in Supabase
- [x] ✅ `sell.inventory` scope registered (covers inventory + video uploads)
- [x] ✅ Video uploads ENABLED (no additional scope needed)

---

## 📱 File Locations

| File | Purpose |
|------|---------|
| `supabase/functions/ebay-publish/constants.ts` | OAuth scopes, video constants |
| `supabase/functions/ebay-publish/auth.ts` | Token exchange, refresh, retrieval |
| `supabase/functions/ebay-publish/video.ts` | Video upload, polling, retry logic |
| `supabase/functions/ebay-publish/publish-create-draft.ts` | Inventory creation with videoIds |
| `src/components/VideoUploadInput.tsx` | Frontend upload UI |
| `src/components/analyze/PolicyAndVideo.tsx` | Analyze page video integration |
| `EBAY_MEDIA_API_IMPLEMENTATION.md` | Full implementation guide |

---

## 🧪 Testing Video Upload End-to-End

```bash
# 1. Start with a test video (10 seconds, MP4, < 10MB)
ffmpeg -f lavfi -i testsrc=duration=10:s=1920x1080:rate=1 -f lavfi -i sine=f=1000:d=10 test.mp4

# 2. Go to Settings → Connect eBay (if not already connected)
# 3. Go to Analyze page → Upload → Select test.mp4
# 4. Wait for upload complete message
# 5. Frontend polls automatically → "Video ready" badge appears
# 6. Create listing with video
# 7. Verify on eBay website that video shows in product gallery
```

---

## 🔗 Useful Links

- **eBay Media API Docs:** https://developer.ebay.com/api-docs/commerce/media/overview.html
- **Sell Inventory API:** https://developer.ebay.com/api-docs/sell/inventory/overview.html
- **Developer Portal:** https://developer.ebay.com/my/keys
- **API Status:** https://status.ebay.com
- **Support:** https://developer.ebay.com/support

---

## 📞 Support Decision Tree

```
Video upload fails?
├─ Status 401/403?
│  └─ Check scope registration & token expiry
├─ Status 400?
│  └─ Check format, duration, file size
├─ Status 404/405?
│  └─ Verify API endpoint & environment match
└─ Still not working?
   └─ Check Supabase logs → server errors shown with timestamp

Video stuck in PROCESSING?
├─ Wait 2-5 minutes & retry
├─ Check eBay status page
└─ Re-upload with different file if persists

Video won't attach to listing?
├─ Verify video status is LIVE (not PROCESSING/FAILED)
├─ Check video statusMessage for policy issues
└─ Ensure category supports video listings
```

---

**Last Updated:** 2026-08-09  
**Implementation Status:** ✅ Complete and Ready  
**Video Upload:** ✅ ENABLED (covered by sell.inventory scope)
