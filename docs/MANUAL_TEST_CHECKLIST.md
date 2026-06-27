# Manual V1 Test Checklist

Use this checklist before calling Route Buddy UK V1 usable.

## Setup

- [ ] App installs or opens inside Shopify Admin
- [ ] Database connection works
- [ ] Prisma migrations have run
- [ ] App loads without server errors
- [ ] Navigation links work inside the embedded Shopify app

## Shopify order import

- [ ] Eligible delivery orders are imported
- [ ] Rapid Delivery orders are included
- [ ] Free Rapid Delivery orders are included
- [ ] Local Delivery orders are included
- [ ] Fulfilled orders are excluded unless intentionally included
- [ ] Refunded orders are excluded unless intentionally included
- [ ] Sample only orders are excluded if they do not need delivery planning
- [ ] Customer name is shown
- [ ] Address is shown
- [ ] Postcode is shown
- [ ] Phone number is shown when available
- [ ] Line items are available for packing and delivery

## Address and map planning

- [ ] Orders with coordinates show on the map
- [ ] Orders without coordinates are clearly flagged
- [ ] Address override flow works
- [ ] Admin can select an order from the map
- [ ] Admin can select an order from the list
- [ ] Selected order count updates correctly
- [ ] Draft route summary updates correctly

## Route creation

- [ ] Admin can create a route from selected orders
- [ ] Route name is generated or editable
- [ ] Route status starts as draft
- [ ] Route appears in the route list
- [ ] Route detail page opens
- [ ] Stops are saved in the correct route
- [ ] Stop order is saved

## Route editing

- [ ] Stops can be reordered
- [ ] Reordered stop sequence persists after refresh
- [ ] Stops can be removed from a draft route if supported
- [ ] Route can be assigned to a driver
- [ ] Route status can move from draft to published or out for delivery
- [ ] Route status can move to completed when all stops are completed

## Driver workflow

- [ ] Driver profile can be created
- [ ] Driver profile can store vehicle details
- [ ] Route can be assigned to driver
- [ ] Secure driver route link works
- [ ] Driver page opens on iPhone browser
- [ ] Driver page opens on Android browser
- [ ] Driver can view stop list
- [ ] Driver can view customer address
- [ ] Driver can view customer phone number when available
- [ ] Driver can view line item summary
- [ ] Driver can mark stop as arrived
- [ ] Driver can mark stop as delivered
- [ ] Driver can mark stop as failed
- [ ] Driver can add delivery note
- [ ] Driver actions update the admin route view

## Proof of delivery

- [ ] Proof photo can be uploaded
- [ ] Proof photo is linked to the correct route stop
- [ ] Proof photo is visible in admin view
- [ ] Proof photo is visible in customer proof view if applicable
- [ ] Upload errors are handled clearly

## Packing and labels

- [ ] Route packing list page opens
- [ ] Packing list includes all stops
- [ ] Packing list includes order numbers
- [ ] Packing list includes customer names
- [ ] Packing list includes addresses
- [ ] Packing list includes line items
- [ ] Delivery labels print clearly
- [ ] Delivery labels include order number, name, address, phone and postcode

## Customer tracking

- [ ] Customer tracking page opens without Shopify Admin access
- [ ] Tracking page does not expose other customers' details
- [ ] Tracking page shows current delivery status
- [ ] Tracking page shows ETA when available
- [ ] Tracking page updates after driver marks delivered or failed

## Basic analytics

- [ ] Total routes count is correct
- [ ] Pending stops count is correct
- [ ] Completed stops count is correct
- [ ] Failed stops count is correct
- [ ] Proof photo count is correct

## Final checks

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] No secrets are committed
- [ ] README is up to date
- [ ] Environment variable guide is up to date
