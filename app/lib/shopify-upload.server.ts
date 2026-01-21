import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

/**
 * Uploads a file to Shopify's CDN using the Files API
 * Returns the hosted URL from Shopify CDN
 */
export async function uploadFileToShopify(
  admin: AdminApiContext,
  file: File,
  altText?: string
): Promise<string | null> {
  try {
    console.log("[Shopify Upload] Starting upload for file:", file.name, "size:", file.size);

    // Step 1: Create staged upload target
    const stagedUploadResponse = await admin.graphql(
      `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          input: [
            {
              resource: "FILE",
              filename: file.name,
              mimeType: file.type,
              fileSize: file.size.toString(),
              httpMethod: "POST",
            },
          ],
        },
      }
    );

    const stagedUploadData = await stagedUploadResponse.json();
    const stagedTarget =
      stagedUploadData.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!stagedTarget) {
      console.error("[Shopify Upload] Failed to create staged upload:", stagedUploadData);
      return null;
    }
    console.log("[Shopify Upload] Staged target created");

    // Step 2: Upload file to the staged URL
    const formData = new FormData();

    // Add parameters from Shopify
    stagedTarget.parameters.forEach((param: { name: string; value: string }) => {
      formData.append(param.name, param.value);
    });

    // Add the actual file directly (File extends Blob, so this works)
    formData.append("file", file);

    console.log("[Shopify Upload] Uploading to staged URL...");
    const uploadResponse = await fetch(stagedTarget.url, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      console.error("[Shopify Upload] Failed to upload file. Status:", uploadResponse.status);
      console.error("[Shopify Upload] Response:", await uploadResponse.text());
      return null;
    }
    console.log("[Shopify Upload] File uploaded successfully to staged URL");

    // Step 3: Create File object in Shopify
    const fileCreateResponse = await admin.graphql(
      `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            ... on MediaImage {
              id
              image {
                url
              }
              alt
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
      {
        variables: {
          files: [
            {
              alt: altText || "Stream thumbnail",
              contentType: "IMAGE",
              originalSource: stagedTarget.resourceUrl,
            },
          ],
        },
      }
    );

    const fileCreateData = await fileCreateResponse.json();
    const createdFile = fileCreateData.data?.fileCreate?.files?.[0];

    if (!createdFile) {
      console.error("[Shopify Upload] Failed to create file:", fileCreateData);
      return null;
    }

    const fileId = createdFile.id;
    console.log("[Shopify Upload] File created with ID:", fileId);

    // Shopify needs time to process the image, so we retry fetching the URL
    let cdnUrl: string | null = createdFile.image?.url || null;
    
    if (!cdnUrl) {
      console.log("[Shopify Upload] Image URL not immediately available, retrying...");
      
      // Retry up to 5 times with 1 second delay
      for (let i = 0; i < 5; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        console.log(`[Shopify Upload] Retry ${i + 1}/5: Fetching file...`);
        const fileQueryResponse = await admin.graphql(
          `
          query getFile($id: ID!) {
            node(id: $id) {
              ... on MediaImage {
                id
                image {
                  url
                }
              }
            }
          }
        `,
          {
            variables: { id: fileId },
          }
        );

        const fileQueryData = await fileQueryResponse.json();
        cdnUrl = fileQueryData.data?.node?.image?.url || null;
        
        if (cdnUrl) {
          console.log("[Shopify Upload] Image URL now available:", cdnUrl);
          break;
        }
      }
    }

    if (!cdnUrl) {
      console.error("[Shopify Upload] Image URL still not available after retries");
      return null;
    }

    console.log("[Shopify Upload] Success! CDN URL:", cdnUrl);
    // Return the Shopify CDN URL
    return cdnUrl;
  } catch (error) {
    console.error("[Shopify Upload] Error uploading file to Shopify:", error);
    return null;
  }
}
