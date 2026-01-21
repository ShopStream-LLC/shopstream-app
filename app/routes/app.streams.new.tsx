import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useActionData, useNavigation, useSubmit } from "react-router";
import { useState, useCallback, useRef } from "react";
import { Page, Layout, Card, Text, Button, TextField, RadioButton, Banner } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { ProductPickerButton, ProductLineup, type ProductDetail } from "../components/ProductLineup";
import { ThumbnailUpload } from "../components/ThumbnailUpload";
import { uploadFileToShopify } from "../lib/shopify-upload.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireShopSession(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { shop, admin } = await requireShopSession(request);

    // Parse form data
    const formData = await request.formData();
    const actionType = formData.get("actionType") as string;

    // Handle fetching product details (read-only, no DB save)
    if (actionType === "fetchProductDetails") {
      const productIdsJson = formData.get("productIds") as string;
      const productIds = JSON.parse(productIdsJson) as string[];

      // Fetch product details from Shopify Admin API
      const productDetails = await Promise.all(
        productIds.map(async (productId) => {
          try {
            // Extract product ID from GID (format: gid://shopify/Product/123)
            const id = productId.includes("/")
              ? productId.split("/").pop()
              : productId;

            const response = await admin.graphql(`
              query getProduct($id: ID!) {
                product(id: $id) {
                  id
                  title
                  featuredImage {
                    url
                    altText
                  }
                  totalInventory
                }
              }
            `, {
              variables: { id: `gid://shopify/Product/${id}` },
            });

            const data = await response.json();
            return {
              productId,
              product: data.data?.product || null,
            };
          } catch (error) {
            console.error(`Error fetching product ${productId}:`, error);
            return {
              productId,
              product: null,
            };
          }
        })
      );

      return { productDetails };
    }

    // Handle creating new stream
    if (actionType === "createStream") {
      const title = formData.get("title") as string;
      const description = formData.get("description") as string | null;
      const startOption = formData.get("startOption") as string;
      const scheduledDate = formData.get("scheduledDate") as string | null;
      const scheduledTime = formData.get("scheduledTime") as string | null;
      const lineupOrderJson = formData.get("lineupOrder") as string | null;

      // Validate title
      if (!title || title.trim() === "") {
        return {
          error: "Title is required",
        };
      }

      // Determine scheduledAt and status
      let scheduledAt: Date | null = null;
      let status: "DRAFT" | "SCHEDULED" = "DRAFT";

      if (startOption === "schedule" && scheduledDate && scheduledTime) {
        const dateTimeString = `${scheduledDate}T${scheduledTime}`;
        scheduledAt = new Date(dateTimeString);
        
        if (scheduledAt <= new Date()) {
          return {
            error: "Scheduled time must be in the future",
          };
        }
        
        status = "SCHEDULED";
      }

      // Handle thumbnail upload
      const thumbnailFile = formData.get("thumbnail") as File | null;
      let thumbnailUrl: string | null = null;
      
      console.log("[Thumbnail Debug - Create] thumbnailFile:", thumbnailFile);
      console.log("[Thumbnail Debug - Create] thumbnailFile type:", typeof thumbnailFile);
      console.log("[Thumbnail Debug - Create] thumbnailFile size:", thumbnailFile?.size);
      
      if (thumbnailFile && thumbnailFile.size > 0) {
        console.log("[Thumbnail Debug - Create] Attempting to upload file to Shopify");
        thumbnailUrl = await uploadFileToShopify(
          admin,
          thumbnailFile,
          `Thumbnail for ${title}`
        );
        console.log("[Thumbnail Debug - Create] Upload result:", thumbnailUrl);
      } else {
        console.log("[Thumbnail Debug - Create] No file to upload - file is null or size is 0");
      }

      // Create stream
      const stream = await db.stream.create({
        data: {
          shop,
          title: title.trim(),
          description: description?.trim() || null,
          thumbnailUrl,
          scheduledAt,
          status,
        },
      });

      // Handle product lineup
      if (lineupOrderJson) {
        const lineupOrder = JSON.parse(lineupOrderJson) as Array<{
          productId: string;
          position: number;
        }>;

        if (lineupOrder.length > 0) {
          await db.streamProduct.createMany({
            data: lineupOrder.map(({ productId, position }) => ({
              streamId: stream.id,
              productId,
              position,
            })),
          });
        }
      }

      // Redirect to stream dashboard
      return redirect(`/app/streams/${stream.id}`);
    }

    return {
      error: "Invalid action type",
    };
  } catch (error) {
    console.error("Error creating stream:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to create stream. Please check server logs.",
    };
  }
};


export default function CreateStream() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startOption, setStartOption] = useState<"immediate" | "schedule">("immediate");
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  
  // Product lineup state
  const [productLineupOrder, setProductLineupOrder] = useState<ProductDetail[]>([]);

  // Thumbnail state
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);

  const handleProductOrderChange = useCallback((newOrder: ProductDetail[]) => {
    setProductLineupOrder(newOrder);
  }, []);

  const handleProductRemove = useCallback((productId: string) => {
    setProductLineupOrder((prev) => prev.filter(
      item => item.streamProduct.id !== productId
    ));
  }, []);

  const handleProductsSelected = useCallback((products: ProductDetail[]) => {
    setProductLineupOrder((prev) => {
      // Check if any of these products are already in the lineup
      const existingProductIds = new Set(prev.map(p => p.streamProduct.productId));
      const newProducts = products.filter(p => !existingProductIds.has(p.streamProduct.productId));
      
      if (newProducts.length === 0) {
        // All products already exist, don't add duplicates
        return prev;
      }
      
      // Calculate positions for new products
      const startPosition = prev.length;
      const productsWithPositions = newProducts.map((product, index) => ({
        ...product,
        streamProduct: {
          ...product.streamProduct,
          position: startPosition + index,
        },
      }));

      // Add to lineup immediately with full details
      return [...prev, ...productsWithPositions];
    });
  }, []);

  const handleThumbnailSelect = useCallback((file: File) => {
    setThumbnailFile(file);
  }, []);

  const handleThumbnailRemove = useCallback(() => {
    setThumbnailFile(null);
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();

  const handleSubmit = useCallback((e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    
    const formData = new FormData(e.currentTarget);
    
    // Manually append the file if it exists
    if (thumbnailFile) {
      formData.set("thumbnail", thumbnailFile);
    }
    
    submit(formData, { method: "post", encType: "multipart/form-data" });
  }, [thumbnailFile, submit]);

  return (
    <Page
      title="Create stream"
      backAction={{
        content: "Streams",
        onAction: () => navigate("/app/streams"),
      }}
    >
      <Layout>
        <Layout.Section>
          {actionData?.error && (
            <Banner tone="critical" onDismiss={() => {}}>
              <Text as="p">{actionData.error}</Text>
            </Banner>
          )}
          <Card>
            <form ref={formRef} method="post" encType="multipart/form-data" onSubmit={handleSubmit}>
              <input type="hidden" name="actionType" value="createStream" />
              <input 
                type="hidden" 
                name="lineupOrder" 
                value={JSON.stringify(
                  productLineupOrder.map((item, index) => ({
                    productId: item.streamProduct.productId,
                    position: index,
                  }))
                )} 
              />
              <Text as="h2" variant="headingMd">
                Stream details
              </Text>
              
              <div style={{ marginTop: "16px" }}>
                <TextField
                  label="Title"
                  name="title"
                  value={title}
                  onChange={setTitle}
                  autoComplete="off"
                  requiredIndicator
                />
              </div>

              <div style={{ marginTop: "16px" }}>
                <TextField
                  label="Description"
                  name="description"
                  value={description}
                  onChange={setDescription}
                  multiline={4}
                  autoComplete="off"
                />
              </div>

              <ThumbnailUpload
                currentThumbnailUrl={null}
                onThumbnailSelect={handleThumbnailSelect}
                onThumbnailRemove={handleThumbnailRemove}
              />

              <div style={{ marginTop: "24px" }}>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Start time
                </Text>
                <div style={{ marginTop: "12px" }}>
                  <RadioButton
                    label="Start immediately"
                    checked={startOption === "immediate"}
                    id="immediate"
                    name="startOption"
                    value="immediate"
                    onChange={() => setStartOption("immediate")}
                  />
                </div>
                <div style={{ marginTop: "12px" }}>
                  <RadioButton
                    label="Schedule for later"
                    checked={startOption === "schedule"}
                    id="schedule"
                    name="startOption"
                    value="schedule"
                    onChange={() => setStartOption("schedule")}
                  />
                </div>
              </div>

              {startOption === "schedule" && (
                <div style={{ marginTop: "16px", display: "flex", gap: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Date"
                      type="date"
                      name="scheduledDate"
                      value={dateValue}
                      onChange={setDateValue}
                      autoComplete="off"
                      requiredIndicator
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Time"
                      type="time"
                      name="scheduledTime"
                      value={timeValue}
                      onChange={setTimeValue}
                      autoComplete="off"
                      requiredIndicator
                    />
                  </div>
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", gap: "12px" }}>
                <Button submit variant="primary" loading={isSubmitting}>
                  Create stream
                </Button>
                <Button onClick={() => navigate("/app/streams")}>
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
          
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <Text as="h2" variant="headingMd">
                Product lineup
              </Text>
              <ProductPickerButton 
                apiKey={apiKey}
                onProductsSelected={handleProductsSelected}
              />
            </div>
            {productLineupOrder.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                No products added yet. Click "Add products" to select products from your store.
              </Text>
            ) : (
              <ProductLineup
                productDetails={productLineupOrder}
                onOrderChange={handleProductOrderChange}
                onRemove={handleProductRemove}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
