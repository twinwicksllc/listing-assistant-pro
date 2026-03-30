# Archive — Original Pages (v1)

These are the original v1 page components, preserved here as a reference and fallback.

**Do not import these directly** — they use the old layout system (BottomNav, no SideNav)
and the original flat styling (no glassmorphism, no gradient backgrounds, no depth).

If you ever need to roll back a page, copy the relevant file from here back to `src/pages/`.

| File | Route | Notes |
|------|-------|-------|
| HomePage.tsx | /home | Main upload/listing page |
| SettingsPage.tsx | /settings | Profile, billing, integrations |
| AnalyzePage.tsx | /analyze | AI listing analyzer |
| DashboardPage.tsx | /dashboard | Owner analytics dashboard |
| BulkListingPage.tsx | /bulk | Bulk CSV listing upload |
| DraftsPage.tsx | /drafts | Saved draft listings |
| MarketResearchPage.tsx | /market | eBay market research |
| RepriceRulesPage.tsx | /reprice-rules | Repricing automation |
| ProfitReportPage.tsx | /profit-report | Profit & loss report |
| BulkCogsPage.tsx | /cogs-editor | Bulk COGS editor |
| HistoricalCogsPage.tsx | /historical-cogs | Historical COGS data |
| AdminPage.tsx | /admin | Admin panel |
| TeamPage.tsx | /team | Team management |
| BillingPage.tsx | /billing | Billing & subscription |
| LandingPage.tsx | /landing | Public landing page |
| LoginPage.tsx | /login | Login |
| SignupPage.tsx | /signup | Signup |
| ForgotPasswordPage.tsx | /forgot-password | Password reset request |
| ResetPasswordPage.tsx | /reset-password | Password reset confirm |
| AuthCallbackPage.tsx | /auth/callback | OAuth callback |
| EbayCallbackPage.tsx | /ebay/callback | eBay OAuth callback |
| TermsPage.tsx | /terms | Terms of service |
| PrivacyPage.tsx | /privacy | Privacy policy |
| NotFound.tsx | * | 404 page |