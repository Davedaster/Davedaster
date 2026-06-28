# Route Buddy roadmap

This roadmap captures the next delivery-management milestones for Bathroom Panels Direct.

## Confirmed current direction

Route Buddy should become an in-house delivery planning, route optimisation, driver workflow and customer tracking platform.

It should keep the existing customer tracking, safe-place instructions, proof of delivery and driver workflow, but add better planning, real maps, live ETA and returns handling.

## Do not add

- Customer-facing delivery rearranging or rescheduling from the tracking page.

## Milestone 1: Route planning settings

Add route-level planning settings so every route has reliable inputs before optimisation and ETA calculation.

Required fields:

- route date
- planned driver start time
- time per drop
- customer slot minutes
- driver start address
- driver start latitude/longitude
- driver finish address
- driver finish latitude/longitude

Recommended behaviour:

- Default start and finish location should be Bathroom Panels Direct, Unit 1 Olympus Business Park, Newton Abbot, TQ12 2SN.
- Start and finish should be editable by address input.
- Address lookup should try to resolve edited start/finish addresses where possible.
- RouteXL should use the route start and finish locations, not a hard-coded shop location.
- ETA calculation should default to the route settings.

## Milestone 2: Main dashboard planning controls

The planning map/dashboard should allow the dispatcher to set these before saving a draft route:

- route date
- driver start time
- time per drop
- customer slot minutes
- start address
- finish address

The route details page should still allow these to be adjusted later while the route is draft or published.

## Milestone 3: Manual orders on planning map

Allow staff to add a manual order/stop directly from the planning map.

Manual order fields:

- customer name
- address
- email
- phone number
- ordered items / line item summary

Manual orders should behave like Shopify orders for:

- route planning
- optimisation
- customer notifications
- tracking link
- driver workflow
- proof of delivery

## Milestone 4: Real maps

Replace the current styled/mock map panels with real map components.

Map requirements:

- admin/planning map showing UK delivery pins
- clickable pins for each delivery
- driver map showing the route and stops
- customer map shown only when appropriate, especially when the customer is next
- keep tracking privacy rule so customers cannot see the driver for the whole route

## Milestone 5: Live driver location and road-data ETA

Add live driver GPS/location updates from the driver route page.

Required behaviour:

- store latest driver location
- update customer ETA as route progress changes
- use road/travel data to refresh ETAs while the driver is on route
- show live driver tracking only when the customer is next or otherwise allowed

## Milestone 6: Returns workflow

Add return ticket handling.

Required behaviour:

- staff can mark a stop/order as a return
- staff can search by order number, customer name, address or postcode
- driver can see return instructions
- driver ticks returned items and quantities
- driver takes return proof image
- customer signs if present
- return proof is stored against the route/stop/order

## Milestone 7: Notification polish

Make customer messages consistent with Bathroom Panels Direct terminology.

Recommended copy direction:

- use “panel delivery” in customer-facing tracking and notification messages
- keep wording clear and reassuring
- avoid suggesting that customers can rearrange the delivery from the tracking page
