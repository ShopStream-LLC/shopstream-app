import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigate, useActionData, useNavigation, useFetcher, useRevalidator } from "react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import { Page, Layout, Card, Text, Button, TextField, RadioButton, Banner, Thumbnail } from "@shopify/polaris";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { mux } from "../lib/mux.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { shop, admin } = await requireShopSession(request);
  const streamId = params.id;

  if (!streamId) {
    throw new Response("Stream not found", { status: 404 });
  }

  const stream = await db.stream.findFirst({
    where: {
      id: streamId,
      shop,
    },
    include: {
      products: {
        orderBy: { position: "asc" },
      },
    },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  // Fetch product details from Shopify Admin API
  const productDetails = await Promise.all(
    stream.products.map(async (streamProduct) => {
      try {
        // Extract product ID from GID (format: gid://shopify/Product/123)
        const productId = streamProduct.productId.includes("/")
          ? streamProduct.productId.split("/").pop()
          : streamProduct.productId;

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
          variables: { id: `gid://shopify/Product/${productId}` },
        });

        const data = await response.json();
        return {
          streamProduct,
          product: data.data?.product || null,
        };
      } catch (error) {
        console.error(`Error fetching product ${streamProduct.productId}:`, error);
        return {
          streamProduct,
          product: null,
        };
      }
    })
  );

  // Fetch Mux stream details if stream is prepared
  let muxStreamDetails = null;
  let isStreamLive = false;
  if (stream.muxStreamId) {
    try {
      const muxStream = await mux.video.liveStreams.retrieve(stream.muxStreamId);
      muxStreamDetails = {
        rtmpUrl: stream.muxRtmpUrl || "rtmps://global-live.mux.com:443/app",
        streamKey: muxStream.stream_key || null,
        status: muxStream.status || null,
      };
    } catch (error) {
      console.error("Error fetching Mux stream details:", error);
      // Continue without Mux details
    }

    // Check Redis for real-time stream state (more reliable than Mux API status)
    try {
      const { redis } = await import("../lib/redis.server");
      const redisState = await redis.get(`stream:${streamId}:state`);
      isStreamLive = redisState === "live";
      
      // Log only on state transitions (not every single request)
      // This avoids flooding the console during live streams
    } catch (error) {
      console.error("Error fetching Redis state:", error);
      // Fallback to database status
      isStreamLive = stream.status === "LIVE";
    }
  }

  return { 
    stream, 
    productDetails,
    muxStreamDetails,
    isStreamLive,
    apiKey: process.env.SHOPIFY_API_KEY || "",
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  try {
    const { shop, admin } = await requireShopSession(request);
    const streamId = params.id;

    if (!streamId) {
      throw new Response("Stream not found", { status: 404 });
    }

    // Validate stream belongs to this shop
    const existingStream = await db.stream.findFirst({
      where: {
        id: streamId,
        shop,
      },
      include: {
        products: true,
      },
    });

    if (!existingStream) {
      throw new Response("Stream not found", { status: 404 });
    }

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

    // Handle different action types
    if (actionType === "updateStream") {
      const title = formData.get("title") as string;
      const description = formData.get("description") as string | null;
      const startOption = formData.get("startOption") as string;
      const scheduledDate = formData.get("scheduledDate") as string | null;
      const scheduledTime = formData.get("scheduledTime") as string | null;
      const lineupOrderJson = formData.get("lineupOrder") as string | null;
      const removedProductsJson = formData.get("removedProducts") as string | null;

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

      // Update stream
      await db.stream.update({
        where: { id: streamId },
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          scheduledAt,
          status,
        },
      });

      // Handle removed products first
      const removedProductIds = removedProductsJson 
        ? JSON.parse(removedProductsJson) as string[]
        : [];
      
      if (removedProductIds.length > 0) {
        await db.streamProduct.deleteMany({
          where: {
            id: { in: removedProductIds },
            streamId,
          },
        });
      }

      // Get remaining products after removals
      const remainingProducts = existingStream.products.filter(
        p => !removedProductIds.includes(p.id)
      );

      // Process lineup order which includes both existing and new products
      if (lineupOrderJson) {
        const lineupOrder = JSON.parse(lineupOrderJson) as Array<{
          streamProductId?: string;
          productId?: string;
          position: number;
          isNew: boolean;
        }>;

        // Separate existing products and new products
        const existingProductUpdates: Array<{ id: string; position: number }> = [];
        const newProductsToAdd: Array<{ productId: string; position: number }> = [];

        lineupOrder.forEach((item) => {
          if (item.isNew && item.productId) {
            // New product - will be added with this position
            newProductsToAdd.push({
              productId: item.productId,
              position: item.position,
            });
          } else if (item.streamProductId && !item.isNew) {
            // Existing product - will update position
            existingProductUpdates.push({
              id: item.streamProductId,
              position: item.position,
            });
          }
        });

        // Add new products first
        if (newProductsToAdd.length > 0) {
          // Get existing product IDs to prevent duplicates
          const existingProductIds = new Set(remainingProducts.map(p => p.productId));

          // Filter out duplicates and add new products
          const uniqueNewProducts = newProductsToAdd.filter(
            p => !existingProductIds.has(p.productId)
          );

          if (uniqueNewProducts.length > 0) {
            await db.streamProduct.createMany({
              data: uniqueNewProducts.map(({ productId, position }) => ({
                streamId,
                productId,
                position,
              })),
            });
          }
        }

        // Update positions for existing products
        if (existingProductUpdates.length > 0) {
          await db.$transaction(
            existingProductUpdates.map(({ id, position }) =>
              db.streamProduct.update({
                where: { id },
                data: { position },
              })
            )
          );
        }
      } else {
        // Fallback: if no lineupOrder but we have new products, add them at the end
        const newProductIdsJson = formData.get("newProductIds") as string | null;
        if (newProductIdsJson) {
          const newProductIds = JSON.parse(newProductIdsJson) as string[];
          if (newProductIds.length > 0) {
            const existingProductIds = new Set(remainingProducts.map(p => p.productId));
            const uniqueNewProductIds = newProductIds.filter(id => !existingProductIds.has(id));

            if (uniqueNewProductIds.length > 0) {
              const maxPosition = remainingProducts.length > 0
                ? Math.max(...remainingProducts.map(p => p.position))
                : -1;

              await db.streamProduct.createMany({
                data: uniqueNewProductIds.map((productId, index) => ({
                  streamId,
                  productId,
                  position: maxPosition + index + 1,
                })),
              });
            }
          }
        }
      }

      return redirect(`/app/streams/${streamId}`);
    }

    if (actionType === "reorderProduct") {
      const streamProductId = formData.get("streamProductId") as string;
      const direction = formData.get("direction") as "up" | "down";

      const streamProduct = existingStream.products.find(p => p.id === streamProductId);
      if (!streamProduct) {
        return {
          error: "Product not found in lineup",
        };
      }

      const currentPosition = streamProduct.position;
      const newPosition = direction === "up" ? currentPosition - 1 : currentPosition + 1;

      // Find the product at the target position
      const targetProduct = existingStream.products.find(p => p.position === newPosition);
      if (!targetProduct) {
        // Already at the edge
        return redirect(`/app/streams/${streamId}`);
      }

      // Swap positions
      await db.$transaction([
        db.streamProduct.update({
          where: { id: streamProductId },
          data: { position: newPosition },
        }),
        db.streamProduct.update({
          where: { id: targetProduct.id },
          data: { position: currentPosition },
        }),
      ]);

      return redirect(`/app/streams/${streamId}`);
    }

    if (actionType === "removeProduct") {
      const streamProductId = formData.get("streamProductId") as string;

      await db.streamProduct.delete({
        where: { id: streamProductId },
      });

      // Reindex positions (optional - can leave gaps for MVP)
      const remainingProducts = existingStream.products
        .filter(p => p.id !== streamProductId)
        .sort((a, b) => a.position - b.position);

      await Promise.all(
        remainingProducts.map((product, index) =>
          db.streamProduct.update({
            where: { id: product.id },
            data: { position: index },
          })
        )
      );

      return redirect(`/app/streams/${streamId}`);
    }

    if (actionType === "addProducts") {
      const productIdsJson = formData.get("productIds") as string;
      const productIds = JSON.parse(productIdsJson) as string[];

      if (!productIds || productIds.length === 0) {
        return {
          error: "No products selected",
        };
      }

      // Get current max position
      const maxPosition = existingStream.products.length > 0
        ? Math.max(...existingStream.products.map(p => p.position))
        : -1;

      // Get existing product IDs to prevent duplicates
      const existingProductIds = new Set(existingStream.products.map(p => p.productId));

      // Add new products
      const newProducts = productIds
        .filter(id => !existingProductIds.has(id))
        .map((productId, index) => ({
          streamId,
          productId,
          position: maxPosition + index + 1,
        }));

      if (newProducts.length > 0) {
        await db.streamProduct.createMany({
          data: newProducts,
        });
      }

      return redirect(`/app/streams/${streamId}`);
    }

    if (actionType === "prepareStream") {
      // Check if stream already has Mux stream
      if (existingStream.muxStreamId) {
        return {
          error: "Stream is already prepared",
        };
      }

      try {
        // Create Mux live stream
        const liveStream = await mux.video.liveStreams.create({
          playback_policy: ["public"],
          new_asset_settings: {
            playback_policy: ["public"],
          },
        });

        // Extract RTMP URL from Mux response
        const rtmpUrl = (liveStream as any).rtmp?.url || "rtmps://global-live.mux.com:443/app";

        // Save to DB
        const playbackId = liveStream.playback_ids?.[0]?.id || null;
        console.log(`[Prepare Stream] Created Mux stream ${liveStream.id}, playbackId: ${playbackId}`);
        
        await db.stream.update({
          where: { id: streamId },
          data: {
            muxStreamId: liveStream.id,
            muxPlaybackId: playbackId,
            muxRtmpUrl: rtmpUrl,
          },
        });

        return redirect(`/app/streams/${streamId}`);
      } catch (error) {
        console.error("Error creating Mux stream:", error);
        return {
          error: error instanceof Error ? error.message : "Failed to create Mux stream. Please check server logs.",
        };
      }
    }

    return redirect(`/app/streams/${streamId}`);
  } catch (error) {
    console.error("Error in action:", error);
    return {
      error: error instanceof Error ? error.message : "Failed to process request. Please check server logs.",
    };
  }
};

function getStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "LIVE":
      return "Live";
    case "ENDED":
      return "Ended";
    case "SCHEDULED":
      return "Scheduled";
    default:
      return status;
  }
}

type ProductDetail = {
  streamProduct: {
    id: string;
    productId: string;
    position: number;
  };
  product: {
    id: string;
    title: string;
    featuredImage: {
      url: string;
      altText: string | null;
    } | null;
    totalInventory: number;
  } | null;
};

function ProductPickerButton({ streamId, apiKey }: { streamId: string; apiKey: string }) {
  const fetcher = useFetcher();

  const handleOpenPicker = useCallback(() => {
    // Dynamically import both App Bridge and ResourcePicker
    Promise.all([
      import("@shopify/app-bridge"),
      import("@shopify/app-bridge/actions")
    ]).then(([{ createApp }, { ResourcePicker }]) => {
      // Prefer host from sessionStorage (persisted by /app shell), fallback to URL parsing.
      const urlParams = new URLSearchParams(window.location.search);
      let shopifyHost =
        urlParams.get("host") ||
        window.sessionStorage.getItem("shopifyHost") ||
        "";

      if (!shopifyHost) {
        const match = window.location.href.match(/[?&]host=([^&]+)/);
        if (match) shopifyHost = decodeURIComponent(match[1]);
      }

      if (!apiKey || !shopifyHost) {
        console.error("Missing API key or host. Cannot create App Bridge client.", { apiKey: !!apiKey, host: shopifyHost });
        return;
      }

      // Create App Bridge client
      const app = createApp({
        apiKey,
        host: shopifyHost,
      });

      const picker = ResourcePicker.create(app, {
        resourceType: ResourcePicker.ResourceType.Product,
        selectMultiple: true,
      } as any);

      picker.subscribe(ResourcePicker.Action.SELECT, (payload: { selection: Array<{ id: string }> }) => {
        const productIds = payload.selection.map((item) => item.id);
        
        if (productIds.length > 0) {
          const formData = new FormData();
          formData.append("actionType", "addProducts");
          formData.append("productIds", JSON.stringify(productIds));
          
          fetcher.submit(formData, { method: "post" });
        }
      });

      picker.dispatch(ResourcePicker.Action.OPEN);
    }).catch((error) => {
      console.error("Error loading ResourcePicker:", error);
    });
  }, [apiKey, fetcher]);

  return (
    <Button onClick={handleOpenPicker} loading={fetcher.state !== "idle"}>
      Add products
    </Button>
  );
}

// Client-only drag-and-drop component
function DraggableProductLineup({ 
  productDetails, 
  onOrderChange,
  onRemove
}: { 
  productDetails: ProductDetail[];
  onOrderChange: (newOrder: ProductDetail[]) => void;
  onRemove: (streamProductId: string) => void;
}) {
  const [items, setItems] = useState(productDetails);

  // Update local state when productDetails change (e.g., after adding products)
  useEffect(() => {
    setItems(productDetails);
  }, [productDetails]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setItems((items) => {
        const oldIndex = items.findIndex((item) => item.streamProduct.id === active.id);
        const newIndex = items.findIndex((item) => item.streamProduct.id === over.id);
        const newItems = arrayMove(items, oldIndex, newIndex);
        onOrderChange(newItems);
        return newItems;
      });
    }
  };

  const handleRemove = (streamProductId: string) => {
    const newItems = items.filter((item) => item.streamProduct.id !== streamProductId);
    setItems(newItems);
    onRemove(streamProductId);
    onOrderChange(newItems);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.streamProduct.id)}
        strategy={verticalListSortingStrategy}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {items.map(({ streamProduct, product }, index) => (
            <SortableProductItem
              key={streamProduct.id}
              streamProduct={streamProduct}
              product={product}
              index={index}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// Static fallback for SSR
function StaticProductLineup({ 
  productDetails, 
  onRemove
}: { 
  productDetails: ProductDetail[];
  onRemove: (streamProductId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {productDetails.map(({ streamProduct, product }, index) => (
        <div
          key={streamProduct.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px",
            border: "1px solid #e1e3e5",
            borderRadius: "4px",
          }}
        >
          <div style={{ minWidth: "40px", textAlign: "center" }}>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {index + 1}
            </Text>
          </div>
          
          {product?.featuredImage?.url ? (
            <Thumbnail
              source={product.featuredImage.url}
              alt={product.featuredImage.altText || product.title}
              size="small"
            />
          ) : (
            <div
              style={{
                width: "40px",
                height: "40px",
                backgroundColor: "#f6f6f7",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text as="span" variant="bodySm" tone="subdued">
                No image
              </Text>
            </div>
          )}
          
          <div style={{ flex: 1 }}>
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {product?.title || "Product not found"}
            </Text>
            {product && (
              <Text as="p" variant="bodySm" tone="subdued">
                Inventory: {product.totalInventory}
              </Text>
            )}
          </div>

          <Button
            size="micro"
            tone="critical"
            onClick={() => onRemove(streamProduct.id)}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}

function ProductLineup({ 
  productDetails, 
  streamId,
  onOrderChange,
  onRemove
}: { 
  productDetails: ProductDetail[];
  streamId: string;
  onOrderChange: (newOrder: ProductDetail[]) => void;
  onRemove: (streamProductId: string) => void;
}) {
  // Prevent dnd-kit hooks from running during server-side rendering
  // typeof window check runs before any hooks, completely preventing SSR execution
  if (typeof window === "undefined") {
    return (
      <StaticProductLineup
        productDetails={productDetails}
        onRemove={onRemove}
      />
    );
  }

  return (
    <DraggableProductLineup
      productDetails={productDetails}
      onOrderChange={onOrderChange}
      onRemove={onRemove}
    />
  );
}

function SortableProductItem({
  streamProduct,
  product,
  index,
  onRemove,
}: {
  streamProduct: { id: string; productId: string; position: number };
  product: {
    id: string;
    title: string;
    featuredImage: { url: string; altText: string | null } | null;
    totalInventory: number;
  } | null;
  index: number;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: streamProduct.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? "grabbing" : "grab",
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "12px",
        border: "1px solid #e1e3e5",
        borderRadius: "4px",
        backgroundColor: isDragging ? "#f6f6f7" : "white",
      }}
    >
      {/* Drag handle icon */}
      <div
        {...attributes}
        {...listeners}
        style={{
          cursor: "grab",
          padding: "8px",
          display: "flex",
          alignItems: "center",
          color: "#6d7175",
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
          <circle cx="13" cy="7" r="1.5" fill="currentColor" />
          <circle cx="7" cy="10" r="1.5" fill="currentColor" />
          <circle cx="13" cy="10" r="1.5" fill="currentColor" />
          <circle cx="7" cy="13" r="1.5" fill="currentColor" />
          <circle cx="13" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </div>

      <div style={{ minWidth: "40px", textAlign: "center" }}>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {index + 1}
        </Text>
      </div>

      {product?.featuredImage?.url ? (
        <Thumbnail
          source={product.featuredImage.url}
          alt={product.featuredImage.altText || product.title}
          size="small"
        />
      ) : (
        <div
          style={{
            width: "40px",
            height: "40px",
            backgroundColor: "#f6f6f7",
            borderRadius: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text as="span" variant="bodySm" tone="subdued">
            No image
          </Text>
        </div>
      )}

      <div style={{ flex: 1 }}>
        <Text as="p" variant="bodyMd" fontWeight="semibold">
          {product?.title || "Product not found"}
        </Text>
        {product && (
          <Text as="p" variant="bodySm" tone="subdued">
            Inventory: {product.totalInventory}
          </Text>
        )}
      </div>

      <Button
        size="micro"
        tone="critical"
        onClick={() => onRemove(streamProduct.id)}
      >
        Remove
      </Button>
    </div>
  );
}

// Helper component for copying stream key
function CopyStreamKeyButton({ streamKey }: { streamKey: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(streamKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [streamKey]);

  return (
    <Button size="micro" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

// Helper component to mask stream key
function MaskedStreamKey({ streamKey }: { streamKey: string }) {
  if (streamKey.length <= 8) {
    return <Text as="span" variant="bodyMd">••••••••</Text>;
  }
  const visible = streamKey.slice(0, 4);
  const masked = "•".repeat(streamKey.length - 8);
  const end = streamKey.slice(-4);
  return (
    <span style={{ fontFamily: "monospace" }}>
      <Text as="span" variant="bodyMd">
        {visible}{masked}{end}
      </Text>
    </span>
  );
}

export default function StreamDashboard() {
  const { stream, productDetails, muxStreamDetails, isStreamLive, apiKey } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [title, setTitle] = useState(stream.title);
  const [description, setDescription] = useState(stream.description || "");
  const [startOption, setStartOption] = useState<"immediate" | "schedule">(
    stream.scheduledAt ? "schedule" : "immediate"
  );
  
  // Local state for product lineup order and removed products
  const [productLineupOrder, setProductLineupOrder] = useState<ProductDetail[]>(productDetails);
  const [removedProducts, setRemovedProducts] = useState<string[]>([]);
  const [newProductIds, setNewProductIds] = useState<string[]>([]);
  
  // Update local state when productDetails change (e.g., after save)
  useEffect(() => {
    setProductLineupOrder(productDetails);
    setRemovedProducts([]);
    setNewProductIds([]); // Clear new products after save
  }, [productDetails]);

  // Poll for stream status updates when stream is prepared
  // Note: We use conservative polling intervals to avoid overwhelming the server
  useEffect(() => {
    // Don't poll if stream isn't prepared yet
    if (!stream.muxStreamId) {
      return;
    }

    // Determine polling frequency based on status
    let pollInterval: number | null = null;
    
    if (stream.status === "SCHEDULED" || stream.status === "DRAFT") {
      // Poll every 15 seconds when waiting for stream to start
      pollInterval = 15000;
    } else if (stream.status === "ENDED") {
      // Poll for 5 minutes after ending (in case stream restarts)
      const endedAt = stream.endedAt ? new Date(stream.endedAt) : null;
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (endedAt && endedAt < fiveMinutesAgo) {
        return; // Don't poll if stream ended over 5 minutes ago
      }
      pollInterval = 15000;
    }
    // Note: Don't poll when LIVE - it creates too much load and isn't needed
    // The stream will stay live until you stop it, and webhooks handle state changes
    
    if (!pollInterval) {
      return; // No polling needed for this status
    }

    const interval = setInterval(() => {
      revalidator.revalidate();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [stream.muxStreamId, stream.status, stream.endedAt, stream.id, revalidator]);
  
  // Format scheduledAt for date/time inputs
  const scheduledDate = stream.scheduledAt
    ? new Date(stream.scheduledAt).toISOString().split("T")[0]
    : "";
  const scheduledTime = stream.scheduledAt
    ? new Date(stream.scheduledAt).toTimeString().slice(0, 5)
    : "";
  
  const [dateValue, setDateValue] = useState(scheduledDate);
  const [timeValue, setTimeValue] = useState(scheduledTime);

  const handleProductOrderChange = useCallback((newOrder: ProductDetail[]) => {
    setProductLineupOrder(newOrder);
  }, []);

  const handleProductRemove = useCallback((streamProductId: string) => {
    // Add to removed products list
    setRemovedProducts((prev) => {
      if (prev.includes(streamProductId)) return prev;
      return [...prev, streamProductId];
    });
    // Remove from display immediately
    setProductLineupOrder((prev) => prev.filter(
      item => item.streamProduct.id !== streamProductId
    ));
    // If it's a new product (temp ID), also remove from newProductIds
    if (streamProductId.startsWith('temp-')) {
      const productId = streamProductId.replace('temp-', '');
      setNewProductIds((prev) => prev.filter(id => id !== productId));
    }
  }, []);

  // Handle adding products (with full product details)
  const handleAddProducts = useCallback((products: ProductDetail[]) => {
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

      // Track product IDs for saving later
      setNewProductIds((current) => {
        const existing = new Set(current);
        productsWithPositions.forEach(p => existing.add(p.streamProduct.productId));
        return Array.from(existing);
      });

      // Add to lineup immediately with full details
      return [...prev, ...productsWithPositions];
    });
  }, []); // Remove productLineupOrder.length dependency to prevent infinite loop

  return (
    <Page
      title={stream.title}
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
            <Form method="post">
              <input type="hidden" name="actionType" value="updateStream" />
              <input 
                type="hidden" 
                name="lineupOrder" 
                value={JSON.stringify(
                  productLineupOrder.map((item, index) => {
                    // For existing products, use streamProductId
                    // For new products (temp IDs), use productId with a prefix
                    if (item.streamProduct.id.startsWith('temp-')) {
                      return {
                        productId: item.streamProduct.productId,
                        position: index,
                        isNew: true,
                      };
                    }
                    return {
                      streamProductId: item.streamProduct.id,
                      position: index,
                      isNew: false,
                    };
                  })
                )} 
              />
              <input 
                type="hidden" 
                name="removedProducts" 
                value={JSON.stringify(removedProducts)} 
              />
              <input 
                type="hidden" 
                name="newProductIds" 
                value={JSON.stringify(newProductIds)} 
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
                  Save
                </Button>
                <Button onClick={() => navigate("/app/streams")}>
                  Back to streams
                </Button>
              </div>
            </Form>
          </Card>
          
          {/* <Card>
            <Text as="h2" variant="headingMd">
              Stream info
            </Text>
            <div style={{ marginTop: "8px" }}>
              <Text as="p" variant="bodyMd">
                <strong>Status:</strong> {getStatusLabel(stream.status)}
              </Text>
            </div>
            <div style={{ marginTop: "8px" }}>
              <Text as="p" variant="bodyMd">
                <strong>Created:</strong>{" "}
                {new Date(stream.createdAt).toLocaleString()}
              </Text>
            </div>
            {stream.scheduledAt && (
              <div style={{ marginTop: "8px" }}>
                <Text as="p" variant="bodyMd">
                  <strong>Scheduled:</strong>{" "}
                  {new Date(stream.scheduledAt).toLocaleString()}
                </Text>
              </div>
            )}
          </Card> */}
          
          <Card>
            <Text as="h2" variant="headingMd">
              Streaming setup
            </Text>
            
            {!stream.muxStreamId ? (
              <div>
                <div style={{ marginBottom: "16px" }}>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Prepare your stream to get RTMP credentials for OBS or your streaming app.
                  </Text>
                </div>
                <Form method="post">
                  <input type="hidden" name="actionType" value="prepareStream" />
                  <Button submit variant="primary" loading={isSubmitting && navigation.formData?.get("actionType") === "prepareStream"}>
                    Prepare stream
                  </Button>
                </Form>
              </div>
            ) : (
              <div>
                {muxStreamDetails && (
                  <>
                    <div style={{ marginTop: "16px" }}>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        RTMP Server URL
                      </Text>
                      <div style={{ marginTop: "8px", padding: "12px", backgroundColor: "#f6f6f7", borderRadius: "4px" }}>
                        <Text as="p" variant="bodyMd">
                          <span style={{ fontFamily: "monospace" }}>
                            {muxStreamDetails.rtmpUrl || "Not available"}
                          </span>
                        </Text>
                      </div>
                    </div>

                    {muxStreamDetails.streamKey && (
                      <div style={{ marginTop: "16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            Stream Key
                          </Text>
                          <CopyStreamKeyButton streamKey={muxStreamDetails.streamKey} />
                        </div>
                        <div style={{ padding: "12px", backgroundColor: "#f6f6f7", borderRadius: "4px" }}>
                          <MaskedStreamKey streamKey={muxStreamDetails.streamKey} />
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: "16px" }}>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Use these credentials in OBS or your streaming app to start broadcasting.
                      </Text>
                    </div>

                    <div style={{ marginTop: "24px" }}>
                      <div style={{ marginBottom: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          Live Preview
                        </Text>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                          <div style={{ display: "flex", gap: "8px", fontSize: "12px", color: "#6d7175" }}>
                            <span>Status: {stream.status}</span>
                            <span>•</span>
                            <span>Redis: {isStreamLive ? "Live" : "Not live"}</span>
                            <span>•</span>
                            <span>Playback ID: {stream.muxPlaybackId ? "✓" : "✗"}</span>
                          </div>
                          {stream.muxStreamId && (
                            <Button 
                              size="micro" 
                              onClick={() => revalidator.revalidate()}
                              loading={revalidator.state === "loading"}
                            >
                              Refresh
                            </Button>
                          )}
                        </div>
                      </div>
                      {isStreamLive && stream.muxPlaybackId ? (
                        <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", backgroundColor: "#000", borderRadius: "4px", overflow: "hidden" }}>
                          <video
                            key={stream.muxPlaybackId}
                            src={`https://stream.mux.com/${stream.muxPlaybackId}.m3u8`}
                            controls
                            muted
                            autoPlay
                            playsInline
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: "100%",
                              objectFit: "contain",
                            }}
                          />
                        </div>
                      ) : (
                        <div style={{ padding: "48px", backgroundColor: "#f6f6f7", borderRadius: "4px", textAlign: "center" }}>
                          <Text as="p" variant="bodyMd" tone="subdued">
                            {!stream.muxPlaybackId 
                              ? "Waiting for playback ID. Start streaming from OBS to initialize."
                              : !isStreamLive
                              ? "Stream not active yet. Start streaming from OBS to see the preview."
                              : "Initializing preview..."
                            }
                          </Text>
                          {!stream.muxPlaybackId && (
                            <div style={{ marginTop: "8px" }}>
                              <Text as="p" variant="bodySm" tone="subdued">
                                Note: Playback ID is usually created within 10-15 seconds after you start streaming.
                              </Text>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </Card>
          
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <Text as="h2" variant="headingMd">
                Product lineup
              </Text>
              <ProductPickerButton 
                streamId={stream.id} 
                apiKey={apiKey}
              />
            </div>
            {productLineupOrder.length === 0 ? (
              <Text as="p" variant="bodyMd" tone="subdued">
                No products added yet. Click "Add products" to select products from your store.
              </Text>
            ) : (
              <ProductLineup
                productDetails={productLineupOrder}
                streamId={stream.id}
                onOrderChange={handleProductOrderChange}
                onRemove={handleProductRemove}
              />
            )}
          </Card>
        </Layout.Section>
        <Layout.Section variant="oneThird">
          {/* <Card>
            <Text as="h2" variant="headingMd">
              Live chat
            </Text>
            <Text as="p" variant="bodyMd">
              Live chat will appear here. This will show viewer messages, system
              notifications, and purchase events.
            </Text>
          </Card>
          <Card>
            <Text as="h2" variant="headingMd">
              Stream stats
            </Text>
            <Text as="p" variant="bodyMd">
              Real-time stats will appear here. This will show viewer count, revenue,
              orders, and average viewer value.
            </Text>
          </Card> */}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
