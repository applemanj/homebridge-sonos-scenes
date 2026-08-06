# Central Broker Deployment on Azure

This guide covers deploying the Sonos broker to Azure App Service for centrally-hosted cloud broker access. Users point their plugins to this broker instead of running their own Docker container.

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────┐         ┌──────────────┐
│ Homebridge      │         │  Azure App Service           │         │ Sonos Cloud  │
│ + Plugin        │────────▶│  (sonos-scenes-broker)       │────────▶│ OAuth + APIs │
│                 │  HTTP   │                              │  HTTPS  │              │
└─────────────────┘         │  - Encrypted token store     │         └──────────────┘
                            │  - OAuth flow                │
                            │  - API proxying              │
                            └──────────────────────────────┘
```

## Prerequisites

- Azure account with free tier eligibility (or existing subscription)
- `az` CLI installed locally (or use Azure Portal web UI)
- Git repo cloned locally
- Node.js 22+ (for local testing)

## Option 1: Deploy via Azure CLI

### 1. Create Azure Resources

```bash
# Set variables
RESOURCE_GROUP="sonos-broker-rg"
APP_NAME="sonos-scenes-broker"
LOCATION="eastus"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create App Service plan (free tier)
az appservice plan create \
  --name "${APP_NAME}-plan" \
  --resource-group $RESOURCE_GROUP \
  --sku F1 \
  --is-linux

# Create App Service (Node.js 22)
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan "${APP_NAME}-plan" \
  --name $APP_NAME \
  --runtime "NODE|22-lts"
```

### 2. Configure Environment Variables

```bash
# Sonos OAuth credentials (register at https://integration.sonos.com/integrations)
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    SONOS_CLIENT_ID="your-client-id" \
    SONOS_CLIENT_SECRET="your-client-secret" \
    SONOS_REDIRECT_URI="https://${APP_NAME}.azurewebsites.net/auth/callback" \
    BROKER_PORT=8080 \
    BROKER_HOST=0.0.0.0 \
    BROKER_TOKEN_SECRET="generate-a-long-random-secret" \
    BROKER_DOCS_URL="https://github.com/applemanj/homebridge-sonos-scenes/blob/main/docs/cloud-broker.md"
```

> **No `BROKER_API_KEY`.** The broker uses per-user API keys minted after each user signs in with Sonos at `/auth/login`. Set a strong `BROKER_TOKEN_SECRET` so user tokens stay decryptable across restarts/redeploys.

### 3. Deploy Code

```bash
# From repo root
cd broker
git init  # if not already a git repo
git add .
git commit -m "Broker deployment"

# Deploy via zip
zip -r deploy.zip src/ package.json
az webapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --src deploy.zip
```

Alternatively, use continuous deployment:

```bash
# Connect to GitHub repo
az webapp deployment github-actions add \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --repo applemanj/homebridge-sonos-scenes \
  --branch main
```

### 4. Verify Deployment

```bash
curl https://${APP_NAME}.azurewebsites.net/healthz
curl https://${APP_NAME}.azurewebsites.net/v1/status
```

## Option 2: Deploy via Azure Portal UI

1. Go to https://portal.azure.com
2. **Create Resource** → App Service
3. **Basics**:
   - Subscription: your subscription
   - Resource Group: create new
   - Name: `sonos-scenes-broker`
   - Publish: Code
   - Runtime Stack: Node 22
   - Region: East US (free tier)
4. **Pricing**: Confirm F1 free tier
5. **Deployment**:
   - Source: GitHub
   - Authorize & select repo: `applemanj/homebridge-sonos-scenes`
   - Branch: `main`
   - Workflow file: auto-generated (or create `.github/workflows/azure-broker.yml`)
6. Create resource
7. Once created, go to **Settings** → **Configuration** and add environment variables:
   - `SONOS_CLIENT_ID`
   - `SONOS_CLIENT_SECRET`
   - `SONOS_REDIRECT_URI`: `https://sonos-scenes-broker.azurewebsites.net/auth/callback`
   - `BROKER_TOKEN_SECRET`: Generate a strong random secret (encrypts user tokens at rest)
8. Restart the app

## Scaling and Costs

**Free Tier (F1):**
- 512 MB RAM
- Shared compute
- 1 GB/day bandwidth
- **Cost**: $0/month
- **Suitable for**: 0–5,000 active users

**Once you exceed free tier:**

| Plan | RAM | Cost/month | Users |
|------|-----|-----------|-------|
| B1 | 1.75 GB | ~$12 | 5,000–50,000 |
| B2 | 3.5 GB | ~$25 | 50,000–200,000 |
| B3 | 7 GB | ~$50 | 200,000+ |

Scaling up is automatic in Azure — just resize the plan in the portal.

## Monitoring

### View Logs

```bash
# Real-time logs
az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME

# Or via Portal: App Service → Log Stream
```

### Health Check

```bash
# Health endpoint (no auth required)
curl https://sonos-scenes-broker.azurewebsites.net/healthz

# Status endpoint (no auth required)
curl https://sonos-scenes-broker.azurewebsites.net/v1/status
```

## Troubleshooting

### Broker returns 500 on /v1/status

Check logs for environment variable issues. Ensure all required env vars are set:

```bash
az webapp config appsettings list \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME
```

### OAuth flow fails

1. Verify `SONOS_REDIRECT_URI` matches exactly what you registered at https://integration.sonos.com
2. Ensure it's `https://` (not http)
3. Check Sonos integration dashboard that Client ID/Secret are correct

### Plugin can't reach broker

1. Test the unauthenticated status endpoint with curl from your machine:
   ```bash
   curl https://sonos-scenes-broker.azurewebsites.net/v1/status
   ```
2. For authenticated endpoints, use your personal key from the OAuth flow:
   ```bash
   curl -H "Authorization: Bearer ssk_your-key" \
     https://sonos-scenes-broker.azurewebsites.net/auth/status
   ```
3. Verify firewall isn't blocking azurewebsites.net
4. Check plugin config has the correct URL and your personal `ssk_...` API key
## Updates

When you push changes to `main`, GitHub Actions automatically redeploys to Azure (if CI/CD is configured). Or manually redeploy:

```bash
zip -r deploy.zip broker/src broker/package.json
az webapp deployment source config-zip \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --src deploy.zip
```

## Tear Down

To delete and stop incurring costs:

```bash
az group delete --name $RESOURCE_GROUP --yes
```

---

**Note:** The central broker is designed to be stateless. User tokens are encrypted at rest in the app's storage, but the app can be restarted or scaled without data loss. If you need to change secrets or migrate, ensure tokens are backed up.
