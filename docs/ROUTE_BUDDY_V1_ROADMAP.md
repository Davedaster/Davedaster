# Route Buddy UK V1 Roadmap

This app is being built from the existing BPD delivery planner.

The goal is to create a working Shopify delivery route planning app for local delivery orders.

## Current app base

The repo already includes:

- Shopify Remix app structure
- Prisma and PostgreSQL database setup
- Shopify order import
- Delivery order filtering
- Address lookup support
- Orders map with selectable delivery pins
- Draft route creation
- Drag and drop route stop ordering
- Driver profiles
- Vehicle details stored against drivers
- Route, stop, delivery group and proof photo database models
- Secure driver route link work from previous milestones
- Proof photo work from previous milestones
- Line item per stop work from previous milestones

This means the existing repo is the correct starting point.

The empty `route-buddy-uk` repo should not be used unless the code is later moved there.

## V1 goal

V1 should be a usable internal delivery planner for Bathroom Panels Direct.

It should allow the admin team to:

1. Import suitable Shopify delivery orders
2. See delivery orders on a map
3. Select orders for a route
4. Save a route
5. Assign a driver
6. Send or open a secure driver route link
7. Let the driver complete deliveries from a mobile friendly page
8. Store delivery status and proof photos
9. Print packing slips or labels for the route

## V1 feature checklist

### 1. App setup and documentation

- Replace the default Shopify template README with app specific setup instructions
- Document required environment variables
- Add local testing steps
- Add deployment notes
- Add a manual test checklist

### 2. Orders and map planning

- Keep Shopify order import
- Keep delivery filtering for Rapid Delivery, Free Rapid Delivery and Local Delivery
- Show all eligible orders in a list
- Show all eligible orders on a map when coordinates are available
- Show orders that need address checks
- Allow order selection from the map
- Allow order selection from the list
- Show selected stop count
- Show draft route summary

### 3. Route building

- Save selected orders as a route
- Allow route name editing
- Allow drag and drop stop reordering
- Allow locked stops
- Store estimated mileage
- Store estimated duration
- Add a simple route optimiser service
- Make the optimiser easy to swap for Google Maps, Mapbox or another routing provider later

### 4. Driver workflow

- Keep driver profiles
- Keep vehicle details
- Assign a driver to a route
- Generate a secure driver link
- Driver route page must work well on iPhone and Android browsers
- Driver can mark arrived
- Driver can mark delivered
- Driver can mark failed
- Driver can upload proof photo
- Driver can add delivery note

### 5. Customer tracking

- Add a customer tracking page
- Show route status
- Show delivery status
- Show estimated delivery time when available
- Show delivered or failed status after the driver updates the stop

### 6. Packing slips and labels

- Add printable packing list per route
- Add printable delivery labels
- Include order number, customer name, address, phone, postcode and line items

### 7. Basic analytics

- Show total routes
- Show completed stops
- Show failed stops
- Show pending stops
- Show proof photo count

## V2 features

These should not block V1.

- SMS notifications
- Email notifications
- Live driver location tracking
- Barcode scanning
- eSignature
- Route calendar view
- Route timeline view
- Auto create routes on a custom schedule
- Advanced postcode zones
- Time window routing
- Vehicle profiles as a separate section
- Advanced delivery performance analytics

## Technical direction

### App stack

- Shopify Remix app
- React
- Shopify Polaris
- Prisma
- PostgreSQL

### Routing providers

V1 can start with a simple coordinate based optimiser.

The code should be structured so that a paid routing provider can be added later without rewriting the app.

Possible future providers:

- Google Maps Routes API
- Mapbox Optimization API
- HERE Routing API

### File storage

Proof photos currently use URL based storage.

For production, this should be connected to a proper storage service.

Possible options:

- Supabase Storage
- Cloudflare R2
- AWS S3

### Notifications

V1 should store tracking events first.

Email and SMS can be added later.

Possible SMS provider:

- Twilio

Possible email providers:

- Resend
- SendGrid
- Shopify customer emails where suitable

## Suggested build order

1. Replace README with app specific instructions
2. Add app environment variable documentation
3. Improve route list and route detail pages
4. Add route assignment to driver
5. Improve mobile driver route page
6. Add proof photo upload flow
7. Add packing list and labels
8. Add customer tracking page
9. Add basic analytics page
10. Add real map provider and route optimisation provider

## Manual test checklist

Before calling V1 usable, test the following:

- App installs into Shopify development store
- Admin can open the app inside Shopify
- Eligible delivery orders are imported
- Ineligible orders are hidden
- Orders with coordinates show on the map
- Orders without coordinates appear as needing address checks
- Admin can select orders
- Admin can save draft route
- Admin can reorder stops
- Admin can assign a driver
- Driver link opens on mobile
- Driver can mark a stop delivered
- Driver can mark a stop failed
- Proof photo is stored and visible
- Route list updates after driver actions
- Packing list prints clearly
- Customer tracking page loads without admin access

## Current priority

Focus on V1 features that make the app usable for BPD internal deliveries.

Do not spend time on advanced automation until the core route, driver and proof of delivery workflow works properly.
