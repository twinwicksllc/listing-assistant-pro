import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false, // Run tests sequentially to avoid test account conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ["html", { outputFolder: "playwright-report" }],
    ["json", { outputFile: "playwright-report/results.json" }],
    ["list"],
  ],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Vercel's Deployment Protection puts an SSO wall in front of every
    // Preview deployment (including the qa branch) by default -- without
    // this header, every request gets redirected to vercel.com/login instead
    // of reaching the app. See LISTING_ASSISTANT_PRO_QA_SETUP.md.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
      extraHTTPHeaders: {
        "x-vercel-protection-bypass":
          process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      },
    }),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 0.0.0.0 --port 8080",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
