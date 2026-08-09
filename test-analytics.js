// Test script to call eBay Analytics API directly
const API_BASE = "https://api.ebay.com";

// You'll need to provide your eBay user token
const USER_TOKEN = "YOUR_USER_TOKEN_HERE"; // Replace with actual token

async function testAnalyticsAPI() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startDate = new Date(yesterday);
  startDate.setDate(startDate.getDate() - 30);

  const startDateStr = startDate.toISOString().split("T")[0].replace(/-/g, "");
  const endDateStr = yesterday.toISOString().split("T")[0].replace(/-/g, "");

  const url = `${API_BASE}/sell/analytics/v1/traffic_report?dimension=LISTING&filter=date_range:[${startDateStr}..${endDateStr}]&metric=LISTING_VIEWS_TOTAL,LISTING_IMPRESSION_TOTAL,CLICK_THROUGH_RATE,SALES_CONVERSION_RATE,TRANSACTION`;

  console.log("Request URL:", url);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${USER_TOKEN}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
    },
  });

  console.log("Response status:", response.status);
  const data = await response.json();
  console.log("Response data:", JSON.stringify(data, null, 2));
}

testAnalyticsAPI();
