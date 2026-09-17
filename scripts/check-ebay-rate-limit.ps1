# One-off manual check of eBay's Browse API rate-limit status.
# Not part of any deployed pipeline -- run this yourself, ad hoc, whenever
# you want to see current quota usage without waiting for a 429.
#
# Usage:
#   $env:EBAY_CLIENT_ID = "your-client-id"
#   $env:EBAY_CLIENT_SECRET = "your-client-secret"
#   .\scripts\check-ebay-rate-limit.ps1
#
# Prints remaining/limit/reset for every api_context eBay reports, with the
# buy.browse row highlighted since that's the one this app's comps searches
# actually consume.

if (-not $env:EBAY_CLIENT_ID -or -not $env:EBAY_CLIENT_SECRET) {
    Write-Host "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as environment variables first." -ForegroundColor Red
    exit 1
}

$credentials = [Convert]::ToBase64String(
    [System.Text.Encoding]::UTF8.GetBytes("$($env:EBAY_CLIENT_ID):$($env:EBAY_CLIENT_SECRET)")
)

Write-Host "Requesting OAuth app token..." -ForegroundColor Cyan
$tokenResp = Invoke-RestMethod -Method Post `
    -Uri "https://api.ebay.com/identity/v1/oauth2/token" `
    -Headers @{
        "Authorization" = "Basic $credentials"
        "Content-Type"  = "application/x-www-form-urlencoded"
    } `
    -Body "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"

$accessToken = $tokenResp.access_token

# eBay's docs have been inconsistent about whether this is v1 or v1_beta --
# try v1 first, fall back to v1_beta on a 404 rather than guessing which is
# current.
$urlsToTry = @(
    "https://api.ebay.com/developer/analytics/v1/rate_limit/",
    "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/"
)

$rateLimits = $null
foreach ($url in $urlsToTry) {
    Write-Host "Querying rate limits at $url ..." -ForegroundColor Cyan
    try {
        $rateLimits = Invoke-RestMethod -Method Get `
            -Uri $url `
            -Headers @{
                "Authorization" = "Bearer $accessToken"
                "Content-Type"  = "application/json"
            }
        break
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 404) {
            Write-Host "  404 at this path -- trying the next candidate." -ForegroundColor Yellow
            continue
        }
        Write-Host "  Request failed with status $status. This may be a scope/permission issue rather than a wrong URL --" -ForegroundColor Red
        Write-Host "  the Analytics API may require a scope beyond the base client-credentials scope this script requests." -ForegroundColor Red
        throw
    }
}

if (-not $rateLimits) {
    Write-Host "None of the candidate URLs worked. eBay may have moved this endpoint again -- worth re-confirming the exact current path via a web-enabled lookup." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== eBay API Rate Limits ===" -ForegroundColor Green
foreach ($ctx in $rateLimits.rateLimits) {
    foreach ($resource in $ctx.resources) {
        foreach ($rate in $resource.rates) {
            $pct = if ($rate.limit -gt 0) { [math]::Round(($rate.count / $rate.limit) * 100, 1) } else { 0 }
            $color = if ($pct -ge 90) { "Red" } elseif ($pct -ge 70) { "Yellow" } else { "White" }
            $highlight = if ($resource.name -like "*browse*") { " <== Browse API (comps searches)" } else { "" }
            Write-Host "[$($ctx.apiContext)] $($resource.name)$highlight" -ForegroundColor $color
            Write-Host "  used: $($rate.count) / $($rate.limit) ($pct%)  remaining: $($rate.remaining)  resets: $($rate.reset)"
        }
    }
}
