import { Form } from "@remix-run/react";
import { BlockStack, Button, InlineStack, Modal, Text } from "@shopify/polaris";
import { useState } from "react";

type ProofPhoto = {
  id: string;
  url: string;
  label?: string | null;
};

export function ProofPhotoGallery({ proofPhotos }: { proofPhotos: ProofPhoto[] }) {
  const [photoToRemove, setPhotoToRemove] = useState<ProofPhoto | null>(null);

  if (!proofPhotos.length) {
    return null;
  }

  return (
    <>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">Proof photos</Text>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 12 }}>
          {proofPhotos.map((photo, index) => (
            <div key={photo.id} style={{ border: "1px solid #d0d5dd", borderRadius: 12, padding: 8, background: "#ffffff" }}>
              <a href={photo.url} target="_blank" rel="noreferrer" style={{ display: "block", textDecoration: "none" }}>
                <img
                  src={photo.url}
                  alt={photo.label || `Proof photo ${index + 1}`}
                  style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 8, display: "block" }}
                />
              </a>
              <Text as="p" variant="bodySm">{photo.label || `Proof photo ${index + 1}`}</Text>
              <InlineStack gap="100">
                <Button size="slim" url={photo.url} target="_blank">Open</Button>
                <Button size="slim" tone="critical" onClick={() => setPhotoToRemove(photo)}>Remove</Button>
              </InlineStack>
            </div>
          ))}
        </div>
      </BlockStack>

      <Modal
        open={Boolean(photoToRemove)}
        onClose={() => setPhotoToRemove(null)}
        title="Remove proof photo?"
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              This will remove the proof photo from this stop and from the customer tracking page.
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              The stored image file will be left in place for safety.
            </Text>
            {photoToRemove ? (
              <img
                src={photoToRemove.url}
                alt={photoToRemove.label || "Proof photo selected for removal"}
                style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, display: "block" }}
              />
            ) : null}
            <InlineStack gap="200" align="end">
              <Button onClick={() => setPhotoToRemove(null)}>Cancel</Button>
              {photoToRemove ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="deleteProofPhoto" />
                  <input type="hidden" name="proofPhotoId" value={photoToRemove.id} />
                  <Button submit tone="critical">Remove proof photo</Button>
                </Form>
              ) : null}
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}
