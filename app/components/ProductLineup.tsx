import { useState, useCallback, useEffect } from "react";
import { Button, Text, Thumbnail } from "@shopify/polaris";
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
import { useFetcher } from "react-router";

export type ProductDetail = {
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

type ProductPickerButtonProps = {
  streamId?: string;
  apiKey: string;
  onProductsSelected?: (products: ProductDetail[]) => void;
};

export function ProductPickerButton({ streamId, apiKey, onProductsSelected }: ProductPickerButtonProps) {
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
          if (streamId) {
            // For existing stream, add products directly
            formData.append("actionType", "addProducts");
            formData.append("productIds", JSON.stringify(productIds));
          } else {
            // For new stream, fetch product details first
            formData.append("actionType", "fetchProductDetails");
            formData.append("productIds", JSON.stringify(productIds));
          }
          
          fetcher.submit(formData, { method: "post" });
        }
      });

      picker.dispatch(ResourcePicker.Action.OPEN);
    }).catch((error) => {
      console.error("Error loading ResourcePicker:", error);
    });
  }, [apiKey, fetcher, streamId]);

  // Handle fetcher response for new stream (when onProductsSelected is provided)
  useEffect(() => {
    if (onProductsSelected && fetcher.data && (fetcher.data as any).productDetails) {
      const productDetails = (fetcher.data as any).productDetails as Array<{
        productId: string;
        product: {
          id: string;
          title: string;
          featuredImage: { url: string; altText: string | null } | null;
          totalInventory: number;
        } | null;
      }>;

      // Convert to ProductDetail format with temporary IDs
      const products: ProductDetail[] = productDetails.map((pd, index) => ({
        streamProduct: {
          id: `temp-${pd.productId}-${Date.now()}-${index}`,
          productId: pd.productId,
          position: 0, // Will be set by parent
        },
        product: pd.product,
      }));

      onProductsSelected(products);
    }
  }, [fetcher.data, onProductsSelected]);

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
  onRemove: (id: string) => void;
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

  const handleRemove = (id: string) => {
    const newItems = items.filter((item) => item.streamProduct.id !== id);
    setItems(newItems);
    onRemove(id);
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
  onRemove: (id: string) => void;
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

export function ProductLineup({ 
  productDetails, 
  onOrderChange,
  onRemove
}: { 
  productDetails: ProductDetail[];
  onOrderChange: (newOrder: ProductDetail[]) => void;
  onRemove: (id: string) => void;
}) {
  // Prevent dnd-kit hooks from running during server-side rendering
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
