import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useFetcher, useLoaderData } from "react-router";
import { useState, useEffect, useRef } from "react";
import { Page, Layout, Card, Button, Banner } from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { ProductPickerButton, DraggableProductLineup, type ProductDetail } from "../components/ProductLineup";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Parent route (app.tsx) already handles authentication
  // We just need to get the API key
  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await requireShopSession(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

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

  if (actionType === "createDraftStream") {
    const productsJson = formData.get("products") as string;
    const products = JSON.parse(productsJson);

    if (!products || products.length === 0) {
      return {
        error: "At least one product is required",
      };
    }

    // Create draft stream with products
    const stream = await db.stream.create({
      data: {
        shop,
        title: "",
        status: "DRAFT",
        products: {
          create: products.map((product: any, index: number) => ({
            productId: product.id,
            position: index,
          })),
        },
      },
    });

    // Return redirect URL for client-side navigation
    return {
      success: true,
      redirect: `/app/streams/new/settings?streamId=${stream.id}`,
      streamId: stream.id,
    };
  }

  return { error: "Invalid action type" };
};

export default function ProductSelectionPage() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [selectedProducts, setSelectedProducts] = useState<ProductDetail[]>([]);
  const hasNavigated = useRef(false);

  // Handle redirect after successful stream creation
  useEffect(() => {
    if (hasNavigated.current || fetcher.state !== "idle") return;
    
    if (fetcher.data && typeof fetcher.data === "object") {
      const data = fetcher.data as any;
      if (data.success && data.redirect) {
        hasNavigated.current = true;
        navigate(data.redirect);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const handleProductsSelected = (products: ProductDetail[]) => {
    // Append new products, avoiding duplicates
    setSelectedProducts((prev) => {
      const existingProductIds = new Set(prev.map((p) => p.streamProduct.productId));
      const newProducts = products.filter(
        (p) => !existingProductIds.has(p.streamProduct.productId)
      );
      
      // Calculate positions for new products
      const startPosition = prev.length;
      const productsWithPositions = newProducts.map((product, index) => ({
        ...product,
        streamProduct: {
          ...product.streamProduct,
          position: startPosition + index,
        },
      }));

      return [...prev, ...productsWithPositions];
    });
  };

  const handleRemoveProduct = (streamProductId: string) => {
    setSelectedProducts(selectedProducts.filter((p) => p.streamProduct.id !== streamProductId));
  };

  const handleReorder = (reorderedProducts: ProductDetail[]) => {
    // Update positions based on new order
    const productsWithUpdatedPositions = reorderedProducts.map((product, index) => ({
      ...product,
      streamProduct: {
        ...product.streamProduct,
        position: index,
      },
    }));
    setSelectedProducts(productsWithUpdatedPositions);
  };

  const handleContinue = () => {
    const formData = new FormData();
    formData.append("actionType", "createDraftStream");
    // Extract product IDs from ProductDetail structure
    formData.append("products", JSON.stringify(
      selectedProducts.map(p => ({ id: p.streamProduct.productId }))
    ));
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Page
      title="Select Products"
      subtitle="Choose products to feature in your live stream"
      backAction={{ content: "Streams", onAction: () => navigate("/app/streams") }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: () => navigate("/app/streams"),
        },
      ]}
      primaryAction={{
        content: `Continue with ${selectedProducts.length} product${selectedProducts.length !== 1 ? "s" : ""}`,
        disabled: selectedProducts.length === 0 || fetcher.state !== "idle",
        loading: fetcher.state !== "idle",
        onAction: handleContinue,
      }}
    >
      <Layout>
        {fetcher.data && typeof fetcher.data === "object" && (fetcher.data as any).error && (
          <Layout.Section>
            <Banner tone="critical" title="Error">
              {(fetcher.data as any).error}
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <div style={{ padding: "16px" }}>
              <div style={{ marginBottom: "16px" }}>
                <ProductPickerButton
                  apiKey={apiKey}
                  onProductsSelected={handleProductsSelected}
                />
              </div>

              {selectedProducts.length > 0 ? (
                <DraggableProductLineup
                  productDetails={selectedProducts}
                  onOrderChange={handleReorder}
                  onRemove={handleRemoveProduct}
                />
              ) : (
                <div
                  style={{
                    textAlign: "center",
                    padding: "48px 16px",
                    color: "#6d7175",
                  }}
                >
                  <svg
                    width="60"
                    height="60"
                    viewBox="0 0 20 20"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    style={{ margin: "0 auto 16px" }}
                  >
                    <path
                      d="M2 6L10 2L18 6M2 6V14L10 18M2 6L10 10M18 6V14L10 18M18 6L10 10M10 10V18"
                      stroke="#8C9196"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p>No products selected yet</p>
                  <p style={{ fontSize: "14px", marginTop: "8px" }}>
                    Click "Select products" above to add products to your stream
                  </p>
                </div>
              )}
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
