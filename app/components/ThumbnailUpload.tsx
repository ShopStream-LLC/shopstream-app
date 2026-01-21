import { useState, useCallback } from "react";
import { DropZone, Text, Button, BlockStack } from "@shopify/polaris";

type ThumbnailUploadProps = {
  currentThumbnailUrl?: string | null;
  onThumbnailSelect: (file: File) => void;
  onThumbnailRemove: () => void;
};

export function ThumbnailUpload({
  currentThumbnailUrl,
  onThumbnailSelect,
  onThumbnailRemove,
}: ThumbnailUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(
    currentThumbnailUrl || null
  );

  const handleDropZoneDrop = useCallback(
    (files: File[]) => {
      const selectedFile = files[0];
      if (!selectedFile) return;

      // Validate file type
      if (!selectedFile.type.startsWith("image/")) {
        alert("Please upload an image file");
        return;
      }

      // Validate file size (max 5MB)
      if (selectedFile.size > 5 * 1024 * 1024) {
        alert("Image must be less than 5MB");
        return;
      }

      setFile(selectedFile);
      onThumbnailSelect(selectedFile);

      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    },
    [onThumbnailSelect]
  );

  const handleRemove = useCallback(() => {
    setFile(null);
    setPreview(null);
    onThumbnailRemove();
  }, [onThumbnailRemove]);

  return (
    <div style={{ marginTop: "16px" }}>
      <Text as="p" variant="bodyMd" fontWeight="semibold">
        Stream Thumbnail
      </Text>
      <div style={{ marginTop: "8px" }}>
        {preview ? (
          <BlockStack gap="200">
            <div
              style={{
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  border: "1px solid #e1e3e5",
                  borderRadius: "8px",
                  padding: "8px",
                  display: "inline-block",
                }}
              >
                <img
                  src={preview}
                  alt="Stream thumbnail"
                  style={{
                    maxWidth: "300px",
                    maxHeight: "200px",
                    borderRadius: "4px",
                    display: "block",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <Button size="slim" onClick={handleRemove}>
                Remove thumbnail
              </Button>
            </div>
          </BlockStack>
        ) : (
          <DropZone
            accept="image/*"
            type="image"
            onDrop={handleDropZoneDrop}
            allowMultiple={false}
          >
            <DropZone.FileUpload actionHint="Accepts .jpg, .png, .gif" />
          </DropZone>
        )}
        <div style={{ marginTop: "8px" }}>
          <Text as="p" variant="bodySm" tone="subdued">
            Recommended: 1280x720px (16:9 ratio). Max 5MB.
          </Text>
        </div>
      </div>
    </div>
  );
}
