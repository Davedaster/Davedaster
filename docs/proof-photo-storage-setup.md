# Proof photo storage setup

This guide explains how to set up external proof photo storage for the BPD Delivery Planner app.

The app does not upload proof photos into Shopify Files.

Instead, it uploads proof photos to an S3 compatible storage bucket and saves the public image link against the delivery group. That link can then be shown on the customer tracking page after delivery.

## What the app needs

Add these environment variables to the app host.

```env
PROOF_PHOTO_STORAGE_ENDPOINT=https://your-storage-endpoint
PROOF_PHOTO_STORAGE_REGION=auto
PROOF_PHOTO_STORAGE_BUCKET=your-bucket-name
PROOF_PHOTO_STORAGE_ACCESS_KEY_ID=your-access-key
PROOF_PHOTO_STORAGE_SECRET_ACCESS_KEY=your-secret-key
PROOF_PHOTO_PUBLIC_BASE_URL=https://your-public-bucket-url
```

## Recommended storage option

Use an S3 compatible provider such as Cloudflare R2.

R2 is a good fit because:

1. It works with S3 style uploads.
2. It can provide a public image URL.
3. It avoids cluttering Shopify Files.
4. It keeps proof photos separate from the main Shopify admin file library.

## Cloudflare R2 setup

1. Log in to Cloudflare.

2. Open R2 Object Storage.

3. Create a new bucket.

Suggested bucket name:

```text
bpd-proof-photos
```

4. Create an API token for the bucket.

The token needs permission to write objects to the bucket.

Save these values:

```text
Access Key ID
Secret Access Key
Endpoint URL
Bucket name
Region
```

For Cloudflare R2, the region is often:

```text
auto
```

5. Make the bucket images publicly viewable.

You can do this with either:

```text
A public R2 bucket URL
```

or

```text
A custom domain connected to the bucket
```

A custom domain is better for the live app.

Example public base URL:

```env
PROOF_PHOTO_PUBLIC_BASE_URL=https://proof.bathroompanelsdirect.co.uk
```

## Example Cloudflare R2 environment values

```env
PROOF_PHOTO_STORAGE_ENDPOINT=https://abc123.r2.cloudflarestorage.com
PROOF_PHOTO_STORAGE_REGION=auto
PROOF_PHOTO_STORAGE_BUCKET=bpd-proof-photos
PROOF_PHOTO_STORAGE_ACCESS_KEY_ID=xxxxxxxxxxxxxxxxxxxx
PROOF_PHOTO_STORAGE_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxx
PROOF_PHOTO_PUBLIC_BASE_URL=https://proof.bathroompanelsdirect.co.uk
```

## How uploads are saved

Each proof photo is saved under this path:

```text
proof-of-delivery/{stopId}/{timestamp}-{randomId}.{extension}
```

Example:

```text
proof-of-delivery/clx123/1715680000000-2c08d0ce-95b4-40e5-b7e8-6fe6f4cfd4f1.jpg
```

The app then saves the public link like this:

```text
https://proof.bathroompanelsdirect.co.uk/proof-of-delivery/clx123/1715680000000-2c08d0ce-95b4-40e5-b7e8-6fe6f4cfd4f1.jpg
```

## File rules

The app allows these image types:

```text
JPG
PNG
WebP
HEIC
HEIF
```

Maximum file size:

```text
10MB
```

The file extension is chosen from the verified image type, not from the uploaded filename.

## Driver workflow

1. Driver opens the route.

2. Driver presses Start route.

3. Driver opens a stop card.

4. Driver uploads a proof photo.

5. Driver presses Mark delivered.

6. The app uploads the photo to external storage.

7. The app saves the public image link.

8. The app marks the stop delivered.

9. The app fulfils the linked Shopify order where possible.

10. The app adds the delivered tag to the Shopify order.

11. The app sends the delivery complete notification if Twilio or Resend are set up.

## Fallback behaviour

If proof photo storage is not set up, the file upload field is hidden.

The driver can still paste a hosted proof photo link manually.

This keeps the delivery flow usable while storage is being set up.

## Security reminders

Do not commit storage keys to GitHub.

Add the environment variables only inside the app host settings.

Keep the storage bucket limited to proof photo uploads only.

Do not reuse the same bucket for public website assets.

## Testing checklist

1. Add all six environment variables.

2. Restart or redeploy the app.

3. Open a driver route.

4. Press Start route.

5. Upload a small JPG image on a stop.

6. Press Mark delivered.

7. Confirm the stop changes to DELIVERED.

8. Confirm the Shopify order has the BPD delivered tag.

9. Open the public tracking page.

10. Confirm the proof photo link opens.

## Troubleshooting

If the upload field does not show, check that all six environment variables are set.

If upload fails with a permission error, check the bucket write permission on the storage access key.

If upload works but the image link does not open, check the public bucket URL or custom domain.

If mobile photos are too large, reduce the phone camera image size or lower the app upload limit in `app/lib/proofPhotoStorage.server.ts`.
