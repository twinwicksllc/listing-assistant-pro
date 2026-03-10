# Teckstart Listing Assistant

An AI-powered Progressive Web App (PWA) for creating optimized eBay listings for coins, bullion, and collectibles.

## Live Demo

**URL**: https://lister.teckstart.com

## Features

- **AI-Powered Analysis**: Upload photos and get AI-generated titles, descriptions, eBay category IDs, and item specifics
- **Smart Pricing**: Automatic price range estimation based on recent sold eBay listings
- **Melt Value Protection**: For precious metals (gold, silver, platinum), enforces pricing below intrinsic melt value
- **Live Spot Prices**: Real-time metal spot prices cached every 15 minutes across all users
- **Draft Management**: Save and manage listing drafts
- **PWA Support**: Install as a mobile app for offline capability
- **Multi-Image Upload**: Analyze multiple photos of the same item from different angles
- **Voice Notes**: Add voice context for AI to consider when generating listings

## Tech Stack

- **Frontend**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **Routing**: React Router v6
- **Auth**: Supabase Auth (Google OAuth + Email)
- **Backend**: Supabase Edge Functions (Deno)
- **AI**: Google Gemini API
- **Database**: Supabase PostgreSQL
- **PWA**: vite-plugin-pwa with Workbox

## Getting Started Locally

### Prerequisites

- Node.js 18+ and npm
- A Supabase project with Google OAuth configured
- Google Gemini API key

### Installation

```bash
# Clone the repository
git clone https://github.com/twinwicksllc/listing-assistant-pro.git
cd listing-assistant-pro

# Install dependencies
npm install

# Copy environment file and fill in your values
cp .env.example .env.local
```

### Environment Variables

Create a `.env.local` file with the following:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_PUBLISHABLE_KEY=your_supabase_anon_key
```

### Running the Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:8080`

## Deployment

### Vercel

1. Connect your GitHub repository to Vercel
2. Set the environment variables in Vercel dashboard
3. Deploy — Vercel automatically builds on push to `main`

### Custom Domain

The app is configured for `lister.teckstart.com`. To use a custom domain:

1. Update the `start_url` in `vite.config.ts` PWA manifest
2. Configure your domain in Vercel settings
3. Update redirect URIs in Google Cloud Console if using OAuth

## Edge Functions

The app uses several Supabase Edge Functions:

- `analyze-item`: Processes images with Gemini AI to generate listing data
- `ebay-pricing`: Fetches recent sold listings for price comparison
- `spot-prices`: Fetches and caches live metal spot prices
- `ebay-publish`: Publishes listings directly to eBay

## eBay Integration

### Taxonomy API Module

The app includes a complete `ebayTaxonomy.ts` module for automated category discovery and item specifics validation:

- **Category Discovery**: Automatically suggest eBay categories based on item descriptions
- **Item Specifics**: Fetch and validate required/recommended attributes for selected categories
- **Intelligent Caching**: 24-hour category cache, 7-day aspect cache using localStorage
- **Error Handling**: Comprehensive error recovery for OAuth, rate limits, and invalid data

**Integration**: See [EBAY_TAXONOMY_INTEGRATION.md](./EBAY_TAXONOMY_INTEGRATION.md) for detailed setup and usage.

### Business Policies

The `useEbayPolicies` hook manages fulfillment, payment, and return policies with:
- 24-hour cache to minimize API calls
- Parallel policy fetching for performance
- Manual refresh capability with cache age display

### Form Validation

List creation uses React Hook Form + Zod for comprehensive validation:
- Required fields: title, description, category, pricing, policies
- Conditional validation for FIXED_PRICE vs AUCTION formats
- Real-time inline error display with disabled submit button
- Full TypeScript type safety

## Database Schema

Key tables:

- `drafts`: Saved listing drafts
- `usage_tracking`: Usage analytics and limits
- `spot_price_cache`: Shared 15-minute cache for metal prices
- `organizations`: Team/organization management
- `organization_members`: Team members

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   React PWA     │────▶│  Supabase Auth   │────▶│  Google OAuth   │
│   (Frontend)    │     │                  │     │                 │
└────────┬────────┘     └──────────────────┘     └─────────────────┘
         │
         ├───────────────┬──────────────┬───────────────┐
         │               │              │               │
         ▼               ▼              ▼               ▼
┌────────────────┐ ┌─────────────┐ ┌────────────┐ ┌─────────────┐
│  Auth Context  │ │  Drafts     │ │  AI API    │ │  eBay API   │
└────────────────┘ └─────────────┘ └────────────┘ └─────────────┘
         │               │              │               │
         └───────────────┴──────────────┴───────────────┘
                                 │
                                 ▼
                       ┌──────────────────┐
                       │   Supabase DB    │
                       │   (PostgreSQL)   │
                       └──────────────────┘
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'feat: add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a pull request

## License

This project is proprietary software owned by Teckstart.