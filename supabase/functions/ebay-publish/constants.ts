// OAuth scope constants
// NOTE: According to eBay documentation, sell.inventory scope grants access to both:
// - Sell Inventory API (create/update listings)
// - Commerce Media API (video uploads/management)
// Additional optional scopes may be added after verifying they are registered for your app.
export const EBAY_OAUTH_SCOPES = [
  "https://api.ebay.com/oauth/api_scope", // Base scope (required)
  "https://api.ebay.com/oauth/api_scope/sell.inventory", // Sell inventory (required for listings + video uploads)
  "https://api.ebay.com/oauth/api_scope/sell.account", // Account access (required)
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly", // Fulfillment (optional)
  // Uncomment the scopes below after confirming they are registered for your app:
  // "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly", // Dashboard analytics
  // "https://api.ebay.com/oauth/api_scope/sell.finances", // Financial data (shipping labels, etc)
  // "https://api.ebay.com/oauth/api_scope/sell.marketing", // eBay marketing
  // "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly", // Identity API (username lookup)
];

// Video upload constants
export const ALLOWED_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/x-msvideo",
  "video/webm",
];
export const MAX_VIDEO_DURATION_SEC = 12;
export const MIN_VIDEO_DURATION_SEC = 2;

// Identity API endpoints
export const IDENTITY_API_PROD = "https://apiz.ebay.com/commerce/identity/v1/user/";
export const IDENTITY_API_SANDBOX = "https://apiz.sandbox.ebay.com/commerce/identity/v1/user/";

// Marketplace constants
export const EBAY_MARKETPLACE_ID = "EBAY_US";
export const CONTENT_LANGUAGE = "en-US";

// Token refresh buffer (5 minutes in milliseconds)
export const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Stripe product IDs for tier determination
export const STRIPE_UNLIMITED_PRODUCT_ID = "prod_U70aT1KvuI2uDx";
export const STRIPE_PRO_PRODUCT_ID = "prod_U6zUiC1SYuPrGU";

// Shared CORS headers for all ebay-publish responses (single source of truth)
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};
