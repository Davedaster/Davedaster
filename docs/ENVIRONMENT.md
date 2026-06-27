# Environment Variables

This document lists the environment variables expected by Route Buddy UK.

Do not commit real secret values to GitHub.

Use `.env` for local development and your hosting provider settings for production.

## Required for Shopify app runtime

```shell
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SCOPES=
SHOPIFY_APP_URL=
DATABASE_URL=
```

### `SHOPIFY_API_KEY`

The public API key for the Shopify app.

This comes from the Shopify Partner dashboard or Shopify CLI app configuration.

### `SHOPIFY_API_SECRET`

The private API secret for the Shopify app.

Never commit this value.

### `SCOPES`

The Shopify access scopes requested by the app.

The app configuration currently requests scopes in `shopify.app.toml`.

Keep this aligned with the app config.

### `SHOPIFY_APP_URL`

The public URL where Shopify can reach the app.

For local development, Shopify CLI normally manages the tunnel URL.

For production, this should be the deployed app URL.

### `DATABASE_URL`

The Prisma database connection string.

Use a development database locally and a production database in deployment.

## Future optional variables

Only add these when the matching feature is implemented.

## Maps and routing

```shell
MAPS_API_KEY=
ROUTING_PROVIDER=
```

Possible routing providers:

- Google Maps Routes API
- Mapbox Optimization API
- HERE Routing API

## Proof photo storage

```shell
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
```

Possible storage providers:

- Supabase Storage
- Cloudflare R2
- AWS S3

## SMS notifications

```shell
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

SMS notifications are a V2 feature.

## Email notifications

```shell
RESEND_API_KEY=
SENDGRID_API_KEY=
```

Email notifications are a V2 feature unless needed earlier for customer tracking.

## Notes

- Never commit `.env`
- Rotate any secret that has been accidentally committed
- Keep production and development credentials separate
- Do not add paid provider keys until the app is ready to use that provider
