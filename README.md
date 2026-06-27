# Route Buddy UK

Route Buddy UK is a Shopify delivery planning app built for Bathroom Panels Direct.

It helps the team import eligible Shopify delivery orders, plan local delivery routes, assign drivers and manage proof of delivery.

The app is based on the Shopify Remix app stack and is currently being developed towards the V1 roadmap in `docs/ROUTE_BUDDY_V1_ROADMAP.md`.

## What V1 is for

V1 is intended to be a practical internal delivery planner.

The first usable version should support:

- Importing eligible Shopify delivery orders
- Filtering local and rapid delivery orders
- Showing delivery orders on a planning map
- Selecting orders for a route
- Creating and editing delivery routes
- Drag and drop route stop ordering
- Assigning drivers
- Opening secure driver route links
- Updating stop status from a mobile friendly driver page
- Capturing proof of delivery photos
- Printing packing lists and delivery labels

More advanced features such as SMS notifications, live driver tracking, barcode scanning, eSignature, time windows and analytics are V2 features.

## Tech stack

- Shopify Remix app
- React
- TypeScript
- Shopify Polaris
- Prisma
- PostgreSQL or another Prisma compatible database

## Important project files

- `package.json` - app scripts and dependencies
- `shopify.app.toml` - Shopify app configuration and access scopes
- `prisma/schema.prisma` - database models
- `app/` - Remix app routes, components and server code
- `docs/ROUTE_BUDDY_V1_ROADMAP.md` - V1 build plan

## Requirements

You need:

- Node.js matching the version in `package.json`
- npm
- Shopify CLI
- A Shopify Partner account
- A Shopify development store or real store for testing
- A database connection string for Prisma

The current Node engine requirement is:

```shell
>=20.19 <22 || >=22.12
```

## Main scripts

Install dependencies:

```shell
npm install
```

Run the app in development:

```shell
npm run dev
```

Generate Prisma client and run migrations:

```shell
npm run setup
```

Build the app:

```shell
npm run build
```

Run TypeScript checks:

```shell
npm run typecheck
```

Run linting:

```shell
npm run lint
```

Deploy Shopify app config:

```shell
npm run deploy
```

## Environment variables

The exact values should not be committed to GitHub.

Use `.env` locally and your hosting provider environment settings in production.

Expected environment variables include:

```shell
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SCOPES=
SHOPIFY_APP_URL=
DATABASE_URL=
```

Depending on the final hosting and proof photo storage setup, V1 or V2 may also need variables such as:

```shell
MAPS_API_KEY=
ROUTING_PROVIDER=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
```

Only add these when the matching feature is actually implemented.

## Shopify access scopes

The app currently requests order, customer, file, fulfilment, inventory, location, product and shipping related scopes in `shopify.app.toml`.

Before production use, check that every requested scope is genuinely needed.

For a private internal delivery planning app, broad scopes may be acceptable, but unused write scopes should be removed if the app does not need them.

## Local setup checklist

1. Clone the repository
2. Run `npm install`
3. Copy or create `.env`
4. Add Shopify app credentials
5. Add `DATABASE_URL`
6. Run `npm run setup`
7. Run `npm run dev`
8. Open the app through Shopify Admin
9. Test order import using a development store or real store test orders

## Manual V1 test checklist

Before calling V1 usable, confirm:

- The app opens inside Shopify Admin
- Eligible delivery orders are imported
- Ineligible orders are hidden
- Orders with coordinates appear on the map
- Orders without coordinates appear as needing address checks
- Orders can be selected from the map
- Orders can be selected from the list
- A draft route can be saved
- Route name can be edited
- Route stops can be reordered
- A driver can be assigned
- The secure driver link opens on mobile
- Driver can mark a stop as arrived
- Driver can mark a stop as delivered
- Driver can mark a stop as failed
- Proof photo can be stored and viewed
- Route list updates after driver actions
- Packing list prints clearly
- Customer tracking page loads without requiring admin access

## Build priorities

Follow this order:

1. Stabilise app setup and documentation
2. Improve route list and route detail pages
3. Improve driver assignment flow
4. Improve mobile driver route page
5. Add or complete proof photo upload flow
6. Add packing list and delivery label pages
7. Add customer tracking page
8. Add basic route analytics
9. Add real map provider and optimiser integrations

## Development rules

- Keep changes small and reviewable
- Work on feature branches
- Open a pull request for each clear step
- Do not mix several major features in one PR
- Do not commit secrets
- Keep V1 focused on the core delivery workflow

## Current status

This project already contains a strong delivery planner base.

The next stage is not to restart the app. The next stage is to improve the existing route, driver and proof of delivery workflow until it is reliable enough for daily internal use.
