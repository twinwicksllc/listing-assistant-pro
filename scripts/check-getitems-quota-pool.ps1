# One-off manual check: which Browse API quota pool does the single-item
# GET /buy/browse/v1/item/{item_id} endpoint actually draw from?
#
# Context: the bulk GET /buy/browse/v1/item?item_ids=... endpoint 403s on
# this account's real keyset (found 2026-09-18, PR #601), so
# attemptItemsRefresh was rewritten to loop single-item getItem calls
# instead. logBrowseApiCall's `resource` tag was left as
# "buy.browse.item.bulk" for dashboard continuity, but that's an assumption,
# not a confirmed fact -- the single-item calls might actually draw from
# "buy.browse" instead, or a third resource eBay doesn't surface a friendly
# name for. eBay's docs don't reliably state this per-operation, so this is
# answered empirically: snapshot getRateLimits before and after a burst of
# real single-item getItem activity and see which resource's count actually
# moved.
#
# Usage:
#   $env:EBAY_CLIENT_ID = "your-client-id"
#   $env:EBAY_CLIENT_SECRET = "your-client-secret"
#   .\scripts\check-getitems-quota-pool.ps1
#
# The script takes a snapshot, then waits for you to press Enter -- go run
# whatever live listing activity will trigger attemptItemsRefresh's
# single-item getItem loop (e.g. publish/reprice listings with existing
# stored comp ids so the "known comps" refresh path fires, not a fresh
# competitor search) in the meantime. Press Enter when done and it takes a
# second snapshot and prints the delta per resource across every
# api_context eBay reports. Whichever resource's `count` increased by
# roughly the number of getItem calls you triggered is the real pool.
#
# Note: this shares the app's own eBay app-token client-credentials flow,
# not a user OAuth token -- same as ebay-quota-monitor's own poll, so the
# numbers here should line up with what that cron and the admin dashboard
# report.

if (-not $env:EBAY_CLIENT_ID -or -not $env:EBAY_CLIENT_SECRET) {
    Write-Host "Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET as environment variables first." -ForegroundColor Red
    exit 1
}

function Get-EbayRateLimitSnapshot {
    $credentials = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes("$($env:EBAY_CLIENT_ID):$($env:EBAY_CLIENT_SECRET)")
    )

    $tokenResp = Invoke-RestMethod -Method Post `
        -Uri "https://api.ebay.com/identity/v1/oauth2/token" `
        -Headers @{
            "Authorization" = "Basic $credentials"
            "Content-Type"  = "application/x-www-form-urlencoded"
        } `
        -Body "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"

    $accessToken = $tokenResp.access_token

    # Same v1/v1_beta fallback as fetchEbayRateLimits in
    # supabase/functions/ebay-quota-monitor/index.ts -- keep these in sync if
    # that ever changes.
    $urlsToTry = @(
        "https://api.ebay.com/developer/analytics/v1/rate_limit/",
        "https://api.ebay.com/developer/analytics/v1_beta/rate_limit/"
    )

    foreach ($url in $urlsToTry) {
        try {
            return Invoke-RestMethod -Method Get `
                -Uri $url `
                -Headers @{
                    "Authorization" = "Bearer $accessToken"
                    "Content-Type"  = "application/json"
                }
        } catch {
            $status = $_.Exception.Response.StatusCode.value__
            if ($status -eq 404) { continue }
            throw
        }
    }

    throw "Neither v1 nor v1_beta rate_limit endpoint responded -- eBay may have moved this again."
}

function ConvertTo-ResourceCountMap($rateLimits) {
    $map = @{}
    foreach ($ctx in $rateLimits.rateLimits) {
        foreach ($resource in $ctx.resources) {
            foreach ($rate in $resource.rates) {
                $key = "[$($ctx.apiContext)] $($resource.name)"
                $map[$key] = [PSCustomObject]@{
                    count     = $rate.count
                    limit     = $rate.limit
                    remaining = $rate.remaining
                }
            }
        }
    }
    return $map
}

Write-Host "Taking BEFORE snapshot..." -ForegroundColor Cyan
$before = ConvertTo-ResourceCountMap (Get-EbayRateLimitSnapshot)

Write-Host ""
Write-Host "Snapshot taken. Now go trigger the single-item getItem refresh path" -ForegroundColor Green
Write-Host "(e.g. publish/reprice a listing with existing stored comp ids so" -ForegroundColor Green
Write-Host "attemptItemsRefresh's known-comps loop fires). Note roughly how many" -ForegroundColor Green
Write-Host "getItem calls you expect to trigger, then press Enter here when done." -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to take the AFTER snapshot"

Write-Host "Taking AFTER snapshot..." -ForegroundColor Cyan
$after = ConvertTo-ResourceCountMap (Get-EbayRateLimitSnapshot)

Write-Host ""
Write-Host "=== Delta by resource (AFTER - BEFORE) ===" -ForegroundColor Green
$allKeys = ($before.Keys + $after.Keys) | Select-Object -Unique | Sort-Object
$anyMoved = $false
foreach ($key in $allKeys) {
    $b = $before[$key]
    $a = $after[$key]
    if (-not $b -or -not $a) {
        Write-Host "$key -- present in only one snapshot (skipped)" -ForegroundColor DarkYellow
        continue
    }
    $delta = $a.count - $b.count
    if ($delta -ne 0) {
        $anyMoved = $true
        $color = if ($key -like "*browse*") { "Yellow" } else { "White" }
        Write-Host "$key : $($b.count) -> $($a.count)  (delta +$delta)" -ForegroundColor $color
    }
}

if (-not $anyMoved) {
    Write-Host "No resource's count changed between snapshots -- either no getItem calls" -ForegroundColor Red
    Write-Host "actually fired, or the delta hasn't propagated to this endpoint yet." -ForegroundColor Red
} else {
    Write-Host ""
    Write-Host "Whichever 'browse'-named resource above moved by roughly your expected" -ForegroundColor Green
    Write-Host "getItem call count is the real quota pool. Compare it to what" -ForegroundColor Green
    Write-Host "logBrowseApiCall currently tags these calls as (buy.browse.item.bulk," -ForegroundColor Green
    Write-Host "in supabase/functions/_helpers/competitorSearch.ts) and fix the tag if" -ForegroundColor Green
    Write-Host "it's tracking the wrong pool." -ForegroundColor Green
}
