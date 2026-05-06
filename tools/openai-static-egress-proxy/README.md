# OpenAI Static Egress Proxy

This service forwards `/v1/chat/completions` requests to OpenAI using a server-side key.
Deploy it on infrastructure with **static outbound IP**, then allowlist that IP in OpenAI.

## Endpoints

- `GET /healthz`
- `POST /v1/chat/completions`

## Required Environment Variables

- `NEW_OPENAI_API_KEY` (or `OPENAI_API_KEY` fallback): OpenAI secret used upstream
- `PROXY_AUTH_TOKEN` (recommended): shared secret required in `X-Proxy-Auth` request header

## Run Locally

```bash
cd tools/openai-static-egress-proxy
export NEW_OPENAI_API_KEY="sk-..."
export PROXY_AUTH_TOKEN="replace-me"
npm start
```

Test:

```bash
curl -s http://localhost:8080/healthz
```

## Cloud Run + Static Egress (GCP)

1. Create a VPC connector for Cloud Run.
2. Route all egress through connector.
3. Attach Cloud NAT with a reserved static external IP.
4. Deploy this service to Cloud Run with env vars above.
5. Add static NAT IP to OpenAI key allowlist.

### Deploy Example

```bash
gcloud run deploy openai-static-egress-proxy \
  --source tools/openai-static-egress-proxy \
  --region us-east1 \
  --allow-unauthenticated \
  --set-env-vars NEW_OPENAI_API_KEY=\"sk-...\",PROXY_AUTH_TOKEN=\"replace-me\"
```

Then lock ingress (authenticated only or load balancer) for production.

## App Integration

Set these Supabase Edge Function env vars:

- `OPENAI_PROXY_URL=https://<your-proxy-domain>/v1/chat/completions`
- `OPENAI_PROXY_AUTH_TOKEN=<same token as PROXY_AUTH_TOKEN>`
- `NEW_OPENAI_API_KEY=<existing app key>`

Current app call sites that honor proxy env:

- `supabase/functions/_helpers/slabOcr.ts`
- `supabase/functions/bulk-generate-descriptions/index.ts`

If `OPENAI_PROXY_URL` is not set, code falls back to direct OpenAI API.
