# Proof photo database migration guide

This guide covers the database step needed after adding multiple proof photos per stop.

PR 37 added a new Prisma model called `ProofPhoto`.

That means the live database needs a migration before the multiple proof photo feature will work.

## What changed

The Prisma schema now includes this model:

```prisma
model ProofPhoto {
  id                String   @id @default(cuid())
  deliveryGroupId   String
  deliveryGroup     DeliveryGroup @relation(fields: [deliveryGroupId], references: [id], onDelete: Cascade)
  url               String
  label             String?
  createdAt         DateTime @default(now())
}
```

The `DeliveryGroup` model also now has this relation:

```prisma
proofPhotos       ProofPhoto[]
```

The existing `proofPhotoUrl` field stays in place.

That field is still used as the primary proof photo link for backwards compatibility.

## Local development migration

Run this locally after pulling the latest `main` branch.

```bash
npm install
npx prisma generate
npx prisma migrate dev --name add-proof-photos
```

This should create a new migration folder under:

```text
prisma/migrations/
```

The migration should create a new `ProofPhoto` table and foreign key to `DeliveryGroup`.

## Production migration

On the live app host, use:

```bash
npx prisma migrate deploy
```

Use `migrate deploy` for production.

Do not use `migrate dev` against the live database.

## Safe order of steps

1. Merge the code changes into `main`.

2. Pull the latest code locally.

3. Generate the Prisma migration locally.

4. Commit the new migration folder.

5. Push and open a PR for the migration file.

6. Merge the migration PR.

7. Deploy the app.

8. Run `npx prisma migrate deploy` on the live app host.

9. Test proof photo upload on a route stop.

## Testing checklist

After deploying the migration:

1. Open a driver route.

2. Press Start route.

3. Upload two proof photos on one stop.

4. Mark the stop delivered.

5. Confirm the stop changes to DELIVERED.

6. Confirm the primary proof photo link is saved.

7. Confirm multiple proof photo records exist for the delivery group.

8. Open the driver route page again.

9. Confirm the stop card shows the saved proof photo links.

10. Open the customer tracking page.

11. Confirm proof photo links appear after delivery.

## Rollback note

The new table only stores proof photo links.

The existing `proofPhotoUrl` field has not been removed.

If the new multiple photo feature has to be paused, the app can still fall back to using the primary proof photo link.

## Things not covered by this migration

This migration does not add:

```text
Photo thumbnails
Delete photo button
Photo captions beyond the simple label field
Storage changes
Driver login
```

Those can be added later.
