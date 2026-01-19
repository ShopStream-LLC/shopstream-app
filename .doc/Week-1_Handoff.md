# StreamCart Live — Week 1 Documentation (Product Lineup + Mux Live Preview)

This document is a **developer documentation** for the current codebase state at the end of “Week 1”.

It is written so a new engineer can:
- Run the app locally
- Understand the data model and key flows
- Continue development without requiring prior context

---

## What’s built in Week 1

### Product Lineup (Admin)
- Merchants can manage a **product lineup** for each Stream.
- Lineup supports:
  - **Select products** via Shopify **Resource Picker**
  - **Reorder** via drag-and-drop (`@dnd-kit`)
  - **Remove** products from lineup
- Lineup is stored in Postgres via Prisma models (`Stream`, `StreamProduct`).
- Product display includes:
  - title
  - thumbnail (featured image)
  - total inventory

### Mux Live Streaming (Admin-only preview)
- Each Stream can be **prepared** for live streaming.
- “Prepare stream” creates a **Mux Live Stream** and stores:
  - `Stream.muxStreamId`
  - `Stream.muxPlaybackId` (may be present immediately, or later)
  - `Stream.muxRtmpUrl`
- Admin UI shows:
  - RTMP Server URL (`rtmps://global-live.mux.com:443/app`)
  - Stream key (masked + copy)
  - Live Preview player (HLS)
- Mux Webhooks update:
  - Redis state: `stream:{id}:state` = `live` | `ended`
  - DB Stream status: `LIVE` | `ENDED`
  - StreamEvent history: `STREAM_STARTED` | `STREAM_ENDED`

---

## Architecture overview

### High-level flow

1. Merchant opens stream edit page: `/app/streams/:id`
2. Page loads Stream + StreamProducts from DB
3. Product details are fetched from Shopify Admin API (`admin.graphql`)
4. If stream is “prepared”, loader also fetches Mux stream details and Redis state
5. Webhooks from Mux update Redis + DB; UI can be refreshed to reflect new state

### Key components/services
- **React Router embedded Shopify app** using `@shopify/shopify-app-react-router`
- **Prisma + Postgres** for data persistence
- **Redis** for real-time-ish stream state (`live/ended`)
- **Mux** for RTMP ingest + HLS playback

---

## Important URLs / Routes

### Admin pages
- `GET /app/streams` — stream list
- `GET /app/streams/:id` — stream details + lineup + Mux setup (main work area)
- `GET /app/debug/redis` — Redis debug page (dev only; blocked in production)

### Webhooks
- `POST /webhooks/mux` — Mux event receiver and processor

---

## Data model (Prisma)

Defined in `prisma/schema.prisma`.

### Stream
- `id`: UUID
- `shop`: myshopify domain
- `title`, `description`
- `status`: `DRAFT | SCHEDULED | LIVE | ENDED`
- Scheduling fields:
  - `scheduledAt`
  - `startedAt`
  - `endedAt`
- Mux fields:
  - `muxStreamId`: Mux live stream id (ingest)
  - `muxPlaybackId`: playback id for HLS preview
  - `muxRtmpUrl`: RTMP server URL (stored explicitly)
- Relations:
  - `products: StreamProduct[]`
  - `events: StreamEvent[]`

### StreamProduct
- `id`: UUID
- `streamId` → Stream
- `productId`: Shopify product identifier (stored string)
- `variantId`: reserved for future
- `position`: lineup ordering
- `featuredAt`: reserved for future “pin/feature” concept

### StreamEvent
- `type`: includes `STREAM_STARTED`, `STREAM_ENDED`, and placeholders for future
- `payload`: JSON (lightweight event metadata)

---

## Redis keys

### Stream state
- `stream:{streamId}:state`
  - `"live"` when Mux sends `video.live_stream.active`
  - `"ended"` when Mux sends `video.live_stream.idle`

Redis client lives in `app/lib/redis.server.ts`.

**Note on timing**: Mux may send `disconnected` and wait before firing `idle` (it can take ~20–60s). This is expected behavior while Mux waits for reconnection.

---

## Mux integration details

### Creating a live stream (Prepare stream)
Implemented in `app/routes/app.streams.$id.tsx` action branch:
- `actionType = "prepareStream"`
- Creates live stream:
  - playback policy: public
  - `new_asset_settings.playback_policy`: public
- Stores in DB:
  - `muxStreamId`
  - `muxPlaybackId` (if present in create response)
  - `muxRtmpUrl` (stored explicitly; app falls back to global Mux RTMPS endpoint)

### Live preview playback URL
- HLS URL format:
  - `https://stream.mux.com/{playbackId}.m3u8`

**Expected latency**: the Admin preview is HLS, which typically has ~6 seconds delay compared to OBS. 

### Webhooks
Implemented in `app/routes/webhooks.mux.tsx`.

#### Signature verification
- Header: `Mux-Signature`
- Requires env `MUX_WEBHOOK_SIGNING_SECRET`
- Verified via `mux.webhooks.unwrap(...)`

#### Events handled
- `video.live_stream.active`
  - sets Redis state to `"live"`
  - updates DB Stream `status=LIVE`, `startedAt=now`
  - attempts to capture playback id from event payload (if present)
  - creates StreamEvent `STREAM_STARTED`
- `video.live_stream.idle`
  - sets Redis state to `"ended"`
  - updates DB Stream `status=ENDED`, `endedAt=now`
  - creates StreamEvent `STREAM_ENDED`
- `video.asset.ready`
  - attempts to extract `playback_ids[0].id` and `live_stream_id`
  - if stream is found and missing playback id, sets `Stream.muxPlaybackId`

#### “Unhandled event type …”
Mux sends additional events (connected/recording/disconnected/live_stream_completed). These are currently **logged but intentionally ignored**.

---

## Shopify Admin API usage

### Product details fetch
In `app/routes/app.streams.$id.tsx` loader:
- For each `StreamProduct`, fetch product info via Admin GraphQL:
  - `title`
  - `featuredImage { url altText }`
  - `totalInventory`

### Embedded app host persistence
In `app/routes/app.tsx`:
- `host` param is persisted to `sessionStorage` as `shopifyHost`
- This prevents App Bridge issues during client-side navigation where `host` disappears from the iframe URL.

---

## Drag-and-drop lineup

Library: `@dnd-kit/*`

Key points:
- Reordering is handled client-side using `arrayMove`
- Final order is persisted when saving stream changes (see `updateStream` action)

---

## Current implementation notes / tradeoffs

### UI updates vs server load
We learned that aggressive polling causes:
- repeated auth calls
- UI instability (asset/CSS fetch failures)
- “Failed to fetch” errors inside Shopify App Bridge

Current approach:
- Prefer **webhooks** for state changes (live/ended)
- UI exposes a **Refresh** button
- Any background refresh should be conservative (and bounded)

### HLS delay
Admin preview uses HLS `.m3u8`, so:
- ~10s delay is normal
- “Moving to Railway” improves tunnel latency and reliability, but does **not** remove HLS buffer latency

---

## Environment variables (local + Railway)

### Required for app
- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES` (example: `write_products`)
- `DATABASE_URL` (Postgres)

### Required for Redis
- `REDIS_URL`

### Required for Mux
- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`
- `MUX_WEBHOOK_SIGNING_SECRET`

### Runtime
- `NODE_ENV=production` on Railway

---

## Deployment to Railway (recommended approach)

### Why Railway helps
- Removes dev tunnel instability and reduces “Failed to fetch” issues.
- Provides a stable public URL for Shopify + Mux webhooks.

### Steps
1. Deploy app service to Railway.
2. Configure Railway variables (see env list above).
3. Ensure DB migrations are applied:
   - `prisma migrate deploy` on boot/build.
4. Update Shopify Partner Dashboard:
   - App URL → Railway domain
   - Allowed redirect URLs → Railway domain
5. Update Mux webhook endpoint URL:
   - `https://{railway-domain}/webhooks/mux`

---

## Debug tooling

### Redis debug page
File: `app/routes/app.debug.redis.tsx`
- Useful during development for verifying:
  - per-stream Redis state
  - all Redis `stream:*` keys and values
- Protected by:
  - `NODE_ENV === "production"` → returns 404

If you don’t want this in the repo long-term, delete the route and rely on:
- Railway logs
- Redis CLI / provider console

---

## Known issues / follow-ups (Week 2 candidates)

### 1) Reduce authentication spam further
Even with conservative UI refresh, actions/loader runs can still trigger auth frequently during development and HMR.
Potential improvements:
- Eliminate any remaining periodic revalidation
- Use a dedicated lightweight endpoint for status checks
- Use SSE/WebSocket for stream state in Admin

### 2) Replace native `<video>` with Mux Player (optional)
Mux Player can provide better HLS playback UX and potentially better buffering behavior.

### 3) Product lineup deferred-saving UX
There was earlier work/iteration on deferring lineup changes until explicit Save. Confirm current behavior and align with product requirements.

---

## Quick dev verification checklist

### Product lineup
- Add product via Resource Picker → appears with title/image/inventory
- Drag reorder → order is reflected
- Save → order persists after refresh

### Mux flow
- Prepare stream → RTMP URL + masked key visible
- Start OBS streaming → webhook logs show “went live”
- Refresh Admin page → Status becomes LIVE, preview plays HLS
- Stop OBS streaming → webhook eventually logs “went idle” and Redis becomes ended

---

## File map (most relevant)

- `app/routes/app.streams.$id.tsx`
  - Stream loader/action
  - Product lineup UI + DnD logic
  - Mux setup UI + preview
- `app/routes/webhooks.mux.tsx`
  - webhook verification + state updates (Redis + DB + StreamEvent)
- `app/lib/mux.server.ts`
  - Mux SDK client
- `app/lib/redis.server.ts`
  - ioredis client
- `prisma/schema.prisma`
  - Stream/StreamProduct/StreamEvent models
- `app/routes/app.tsx`
  - embedded app shell + host persistence for App Bridge

