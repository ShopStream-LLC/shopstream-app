import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useState, useRef, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  Banner,
  Text,
  BlockStack,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { requireShopSession } from "../auth.server";
import db from "../db.server";
import { ThumbnailUpload } from "../components/ThumbnailUpload";
import { TagsInput } from "../components/TagsInput";
import { RecurringStreamToggle } from "../components/RecurringStreamToggle";
import { MulticastStreamingToggles } from "../components/MulticastStreamingToggles";
import { uploadFileToShopify } from "../lib/shopify-upload.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireShopSession(request);
  const url = new URL(request.url);
  const streamId = url.searchParams.get("streamId");

  if (!streamId) {
    throw new Response("Stream ID required", { status: 400 });
  }

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
    include: { products: true },
  });

  if (!stream) {
    throw new Response("Stream not found", { status: 404 });
  }

  return { stream };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, admin } = await requireShopSession(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");
  const streamId = formData.get("streamId") as string;

  if (!streamId) {
    return { error: "Stream ID required" };
  }

  const stream = await db.stream.findFirst({
    where: { id: streamId, shop },
  });

  if (!stream) {
    return { error: "Stream not found" };
  }

  if (actionType === "saveDraft") {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const tagsJson = formData.get("tags") as string;
    const tags = tagsJson ? JSON.parse(tagsJson) : [];
    const thumbnailFile = formData.get("thumbnail") as File | null;

    // Validate title
    if (!title || title.trim() === "") {
      return { error: "Title is required" };
    }

    // Upload thumbnail if provided
    let thumbnailUrl = stream.thumbnailUrl;
    if (thumbnailFile && thumbnailFile.size > 0) {
      try {
        thumbnailUrl = await uploadFileToShopify(admin, thumbnailFile);
      } catch (error) {
        console.error("[Settings] Thumbnail upload failed:", error);
        return { error: "Failed to upload thumbnail" };
      }
    }

    // Update stream
    await db.stream.update({
      where: { id: streamId },
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        tags,
        thumbnailUrl,
      },
    });

    // Return redirect data for client-side navigation (preserves embedded app session)
    return { success: true, redirect: "/app/streams" };
  }

  if (actionType === "continue") {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string | null;
    const tagsJson = formData.get("tags") as string;
    const tags = tagsJson ? JSON.parse(tagsJson) : [];
    const startOption = formData.get("startOption") as string;
    const scheduledDate = formData.get("scheduledDate") as string | null;
    const scheduledTime = formData.get("scheduledTime") as string | null;
    const isRecurring = formData.get("isRecurring") === "true";
    const recurringFrequency = formData.get("recurringFrequency") as string | null;
    const multicastFacebook = formData.get("multicastFacebook") === "true";
    const multicastInstagram = formData.get("multicastInstagram") === "true";
    const multicastTiktok = formData.get("multicastTiktok") === "true";
    const thumbnailFile = formData.get("thumbnail") as File | null;

    // Validate title
    if (!title || title.trim() === "") {
      return { error: "Title is required" };
    }

    // Determine scheduledAt and status
    let scheduledAt: Date | null = null;
    let status: "DRAFT" | "SCHEDULED" = "DRAFT";

    if (startOption === "schedule" && scheduledDate && scheduledTime) {
      const dateTimeString = `${scheduledDate}T${scheduledTime}`;
      scheduledAt = new Date(dateTimeString);

      if (scheduledAt <= new Date()) {
        return { error: "Scheduled time must be in the future" };
      }

      status = "SCHEDULED";
    }

    // Upload thumbnail if provided
    let thumbnailUrl = stream.thumbnailUrl;
    if (thumbnailFile && thumbnailFile.size > 0) {
      try {
        thumbnailUrl = await uploadFileToShopify(admin, thumbnailFile);
      } catch (error) {
        console.error("[Settings] Thumbnail upload failed:", error);
        return { error: "Failed to upload thumbnail" };
      }
    }

    // Update stream
    await db.stream.update({
      where: { id: streamId },
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        tags,
        scheduledAt,
        status,
        isRecurring,
        recurringFrequency: isRecurring ? recurringFrequency : null,
        multicastFacebook,
        multicastInstagram,
        multicastTiktok,
        thumbnailUrl,
      },
    });

    return { success: true, redirect: `/app/streams/new/preflight?streamId=${streamId}` };
  }

  return { error: "Invalid action type" };
};

export default function StreamSettingsPage() {
  const { stream } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  const hasNavigated = useRef(false);
  const [submittingAction, setSubmittingAction] = useState<"saveDraft" | "continue" | null>(null);

  const [title, setTitle] = useState(stream.title);
  const [description, setDescription] = useState(stream.description || "");
  const [tags, setTags] = useState<string[]>(stream.tags || []);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(stream.thumbnailUrl);
  const [startOption, setStartOption] = useState<"immediate" | "schedule">("immediate");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [isRecurring, setIsRecurring] = useState(stream.isRecurring || false);
  const [recurringFrequency, setRecurringFrequency] = useState(stream.recurringFrequency || "weekly");
  const [multicastFacebook, setMulticastFacebook] = useState(stream.multicastFacebook || false);
  const [multicastInstagram, setMulticastInstagram] = useState(stream.multicastInstagram || false);
  const [multicastTiktok, setMulticastTiktok] = useState(stream.multicastTiktok || false);

  const handleMulticastChange = (platform: "facebook" | "instagram" | "tiktok", enabled: boolean) => {
    if (platform === "facebook") setMulticastFacebook(enabled);
    if (platform === "instagram") setMulticastInstagram(enabled);
    if (platform === "tiktok") setMulticastTiktok(enabled);
  };

  const handleThumbnailSelect = (file: File) => {
    setThumbnail(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setThumbnailPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleThumbnailRemove = () => {
    setThumbnail(null);
    setThumbnailPreview(stream.thumbnailUrl);
  };

  const handleSubmit = (action: "saveDraft" | "continue") => {
    setSubmittingAction(action); // Track which action is being submitted
    const formData = new FormData();
    formData.append("actionType", action);
    formData.append("streamId", stream.id);
    formData.append("title", title);
    formData.append("description", description);
    formData.append("tags", JSON.stringify(tags));
    formData.append("startOption", startOption);
    formData.append("scheduledDate", scheduledDate);
    formData.append("scheduledTime", scheduledTime);
    formData.append("isRecurring", String(isRecurring));
    formData.append("recurringFrequency", recurringFrequency);
    formData.append("multicastFacebook", String(multicastFacebook));
    formData.append("multicastInstagram", String(multicastInstagram));
    formData.append("multicastTiktok", String(multicastTiktok));

    if (thumbnail) {
      formData.append("thumbnail", thumbnail);
    }

    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  // Handle redirect after successful action (client-side navigation preserves embedded app session)
  useEffect(() => {
    if (hasNavigated.current || fetcher.state !== "idle") return;
    
    if (fetcher.data && typeof fetcher.data === "object") {
      const data = fetcher.data as any;
      if (data.success && data.redirect) {
        hasNavigated.current = true;
        setSubmittingAction(null); // Reset submitting action
        navigate(data.redirect);
      }
    }
    // Reset submitting action when fetcher becomes idle (even if there was an error)
    if (fetcher.state === "idle" && submittingAction) {
      setSubmittingAction(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]);

  const isTitleValid = title.trim() !== "";

  return (
    <Page
      title="Stream Settings"
      subtitle="Configure your live streaming session"
      backAction={{
        content: "Back",
        onAction: () => navigate(`/app/streams/new/products?streamId=${stream.id}`),
      }}
      secondaryActions={[
        {
          content: "Save Draft",
          disabled: !isTitleValid || fetcher.state !== "idle",
          loading: submittingAction === "saveDraft" && fetcher.state !== "idle",
          onAction: () => handleSubmit("saveDraft"),
        },
      ]}
      primaryAction={{
        content: "Next: Pre-Flight Check",
        disabled: !isTitleValid || fetcher.state !== "idle",
        loading: submittingAction === "continue" && fetcher.state !== "idle",
        onAction: () => handleSubmit("continue"),
      }}
    >
      <form ref={formRef}>
        <Layout>
          {fetcher.data && typeof fetcher.data === "object" && (fetcher.data as any).error && (
            <Layout.Section>
              <Banner tone="critical" title="Error">
                {(fetcher.data as any).error}
              </Banner>
            </Layout.Section>
          )}

          <Layout.Section variant="oneHalf">
            {/* Stream Details Card */}
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Stream Details
                  </Text>

                  <TextField
                    label="Stream Title"
                    value={title}
                    onChange={setTitle}
                    placeholder="Enter a compelling title for your stream"
                    autoComplete="off"
                    requiredIndicator
                  />

                  <TextField
                    label="Description"
                    value={description}
                    onChange={setDescription}
                    placeholder="Describe what viewers can expect from this stream..."
                    multiline={4}
                    autoComplete="off"
                  />

                  <TagsInput tags={tags} onChange={setTags} />
                </BlockStack>
              </Card>

              {/* Schedule Card */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Schedule
                  </Text>

                  <InlineStack gap="200">
                    <Button
                      variant={startOption === "immediate" ? "primary" : undefined}
                      onClick={() => setStartOption("immediate")}
                    >
                      Start Immediately
                    </Button>
                    <Button
                      variant={startOption === "schedule" ? "primary" : undefined}
                      onClick={() => setStartOption("schedule")}
                    >
                      Schedule for Later
                    </Button>
                  </InlineStack>

                  {startOption === "schedule" && (
                    <BlockStack gap="400">
                      <TextField
                        label="Date"
                        type="date"
                        value={scheduledDate}
                        onChange={setScheduledDate}
                        autoComplete="off"
                      />
                      <TextField
                        label="Time"
                        type="time"
                        value={scheduledTime}
                        onChange={setScheduledTime}
                        autoComplete="off"
                      />
                    </BlockStack>
                  )}

                  <Divider />

                  <RecurringStreamToggle
                    isRecurring={isRecurring}
                    frequency={recurringFrequency}
                    onToggle={setIsRecurring}
                    onFrequencyChange={setRecurringFrequency}
                  />
                </BlockStack>
              </Card>

              {/* Multi-cast Streaming Card */}
              <Card>
                <BlockStack gap="400">
                  <div>
                    <Text variant="headingMd" as="h2">
                      Multi-cast Streaming
                    </Text>
                    <Text variant="bodySm" tone="subdued" as="p">
                      Broadcast simultaneously to multiple platforms
                    </Text>
                  </div>

                  <MulticastStreamingToggles
                    facebook={multicastFacebook}
                    instagram={multicastInstagram}
                    tiktok={multicastTiktok}
                    onChange={handleMulticastChange}
                  />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <BlockStack gap="400">
              {/* Stream Thumbnail Card */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Stream Thumbnail
                  </Text>

                  <ThumbnailUpload
                    currentThumbnailUrl={thumbnailPreview}
                    onThumbnailSelect={handleThumbnailSelect}
                    onThumbnailRemove={handleThumbnailRemove}
                  />
                </BlockStack>
              </Card>

              {/* Pro Tips Card */}
              <Card>
                <BlockStack gap="400">
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                      <path
                        d="M10 2L12.09 7.26L18 8.27L14 12.14L14.91 18L10 15.27L5.09 18L6 12.14L2 8.27L7.91 7.26L10 2Z"
                        fill="#FFC107"
                      />
                    </svg>
                    <Text variant="headingMd" as="h2">
                      Pro Tips
                    </Text>
                  </div>

                  <BlockStack gap="200">
                    <Text variant="bodySm" as="p">
                      • Use clear, action-oriented titles
                    </Text>
                    <Text variant="bodySm" as="p">
                      • Mention key products or deals
                    </Text>
                    <Text variant="bodySm" as="p">
                      • Schedule during peak audience hours
                    </Text>
                    <Text variant="bodySm" as="p">
                      • Add relevant tags for discoverability
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </form>
    </Page>
  );
}
