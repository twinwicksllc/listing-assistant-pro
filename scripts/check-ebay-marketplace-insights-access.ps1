# One-off manual test: do we actually have real access to eBay's Marketplace
# Insights API (buy.marketplaceinsight), or does that quota bucket showing up
# in getRateLimits just mean it's allocated-by-default and unused?
#
# CLAUDE.md documents "no Marketplace Insights access" based on a code
# comment, not a live test -- this script is that live test. A 200 means
# real, actual sold-transaction data access (which would let this app move
# sold-data lookups off the risky Jina-scraping path entirely, onto an
# official quota that's separate from buy.browse's already-strained 5,000/
# day). A 403 means the quota bucket is just a default allocation with no
# real entitlement behind it -- confirming today's assumption.
#
# NOTE: the exact endpoint path and required OAuth scope below are from the
# assistant's training data, not a live-verified lookup -- if this returns a
# 404 (wrong path) rather than a 403 (right path, no access), that's
# inconclusive, not a "no access" answer. Re-confirm the exact path/scope via
# a web-enabled lookup if that happens.
#
# Usage:
#   $env:EBAY_CLIENT_ID = "your-client-id"
#   $env:EBAY_CLIENT_SECRET = "your-client-secret"
#   .\scripts\check-ebay-marketplace-insights-access.ps1

if (-not $env:EBAY_CLIENT_ID -or -not $env:EBAY_CLIENT_SECRET) {
    Write-Host "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as environment variables first." -ForegroundColor Red
    exit 1
}

$credentials = [Convert]::ToBase64String(
    [System.Text.Encoding]::UTF8.GetBytes("$($env:EBAY_CLIENT_ID):$($env:EBAY_CLIENT_SECRET)")
)

# Marketplace Insights requires a scope beyond the base api_scope this app's
# other calls use -- request both, so a scope-grant failure at the token
# step (rather than the API call step) is caught early and reported clearly.
$scopes = "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/buy.marketplace.insights"

Write-Host "Requesting OAuth app token with Marketplace Insights scope..." -ForegroundColor Cyan
try {
    $tokenResp = Invoke-RestMethod -Method Post `
        -Uri "https://api.ebay.com/identity/v1/oauth2/token" `
        -Headers @{
            "Authorization" = "Basic $credentials"
            "Content-Type"  = "application/x-www-form-urlencoded"
        } `
        -Body "grant_type=client_credentials&scope=$([Uri]::EscapeDataString($scopes))"
} catch {
    Write-Host "Token request failed. If the error mentions an invalid/unauthorized scope, that itself is informative --" -ForegroundColor Red
    Write-Host "it means this app's keyset was never granted the Marketplace Insights scope at all (a decision made in" -ForegroundColor Red
    Write-Host "eBay's developer portal, not something this script can work around)." -ForegroundColor Red
    throw
}

$accessToken = $tokenResp.access_token
Write-Host "Token acquired. Granted scope(s): $($tokenResp.scope)" -ForegroundColor Green

if ($tokenResp.scope -notlike "*marketplace.insights*") {
    Write-Host ""
    Write-Host "The token response does NOT list the marketplace.insights scope as granted." -ForegroundColor Yellow
    Write-Host "This strongly suggests this app's keyset is not entitled to Marketplace Insights," -ForegroundColor Yellow
    Write-Host "even though a quota bucket for it appeared in getRateLimits. Continuing to the API" -ForegroundColor Yellow
    Write-Host "call anyway, to see exactly how it fails." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Calling Marketplace Insights item_sales/search (harmless read-only query)..." -ForegroundColor Cyan
try {
    $resp = Invoke-RestMethod -Method Get `
        -Uri "https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?q=iphone&limit=1" `
        -Headers @{
            "Authorization"              = "Bearer $accessToken"
            "X-EBAY-C-MARKETPLACE-ID"    = "EBAY_US"
            "Content-Type"               = "application/json"
        }
    Write-Host ""
    Write-Host "SUCCESS -- this app DOES have real Marketplace Insights access." -ForegroundColor Green
    Write-Host "Sample response (first item, if any):" -ForegroundColor Green
    $resp.itemSales | Select-Object -First 1 | Format-List
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host ""
    if ($status -eq 403) {
        Write-Host "403 Forbidden -- confirms NO real Marketplace Insights access. The quota bucket in" -ForegroundColor Red
        Write-Host "getRateLimits was just a default allocation, not an entitlement. This matches the" -ForegroundColor Red
        Write-Host "existing assumption in CLAUDE.md/keyword-research/index.ts." -ForegroundColor Red
    } elseif ($status -eq 404) {
        Write-Host "404 Not Found -- INCONCLUSIVE. This likely means the endpoint path or API version" -ForegroundColor Yellow
        Write-Host "in this script is wrong (eBay may have moved/renamed it), not that access is denied." -ForegroundColor Yellow
        Write-Host "Re-confirm the exact current path via a web-enabled lookup before concluding anything." -ForegroundColor Yellow
    } else {
        Write-Host "Unexpected status $status. See the error below for detail." -ForegroundColor Red
    }
    throw
}
