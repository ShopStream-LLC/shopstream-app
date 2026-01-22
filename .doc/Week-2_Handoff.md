# StreamCart Live — Week 2 Documentation (Streams + Wizard + Go Live + LL-HLS)

This document is a **developer handoff** for the current codebase state at the end of “Week 2”.

It is written so a new engineer can:
- Run the app locally
- Understand the stream creation + “go live” flow
- Understand the admin live control page + live preview behavior
- Continue development in Week 3+ without prior context

---

## What’s built in Week 2

### Streams list (Upcoming / Past)
- Admin route: `GET /app/streams` (Streams list)
- The list uses **Tabs**:
  - **Upcoming Streams**: `DRAFT | SCHEDULED`
  - **Past Streams**: `ENDED`
- Each tab shows a **count** in its label.
- Stream cards show:
  - thumbnail (or placeholder)
  - title / description
  - scheduled time (if present)
  - product count
  - status badge (Upcoming only)
- Past streams:
  - no “Edit” or “Go Live”
  - includes placeholder buttons (**See Stats**, **Share**) with **no functionality yet**
  - shows mock stats (duration, sales, peak viewers) deterministically derived from `stream.id`
  - scheduled time is displayed (per feedback)

Primary file: `app/routes/app.streams._index.tsx`

---

### Create Stream wizard (multi-step)

This replaces the older “single page creation” approach with a wizard using dedicated routes:

#### Step 1 — Select Products
Route: `GET/POST /app/streams/new/products`

- Product selection via Shopify **Resource Picker**
- Shows selected products with:
  - drag-and-drop reordering (`@dnd-kit`)
  - remove product
- “Continue” creates a draft Stream + StreamProducts and navigates to Step 2
- Default title for new streams is an empty string (`""`) instead of “Untitled Stream”
- Fixes:
  - avoids infinite loops when processing picker results
  - client-side navigation guard to prevent double-redirect on fetcher completion

Primary files:
- `app/routes/app.streams.new.products.tsx`
- `app/components/ProductLineup.tsx` (`ProductPickerButton`, `DraggableProductLineup`)

#### Step 2 — Stream Settings
Route: `GET/POST /app/streams/new/settings?streamId=...`

- Title + Description
- Tags input (internal-only)
- Schedule:
  - start immediately OR schedule for later
  - scheduled date/time → saved to `Stream.scheduledAt` and `Stream.status = SCHEDULED`
- Thumbnail upload via Shopify Files API (Shopify CDN URL persisted on Stream)
- UI-only toggles (stored but not “wired” yet):
  - recurring stream (daily/weekly/monthly)
  - multi-cast (Facebook / Instagram / TikTok)
- Buttons:
  - Save Draft → saves + redirects back to Streams list
  - Next: Pre-Flight Check → saves + routes to Step 3

Primary files:
- `app/routes/app.streams.new.settings.tsx`
- `app/components/TagsInput.tsx`
- `app/components/ThumbnailUpload.tsx`
- `app/components/RecurringStreamToggle.tsx`
- `app/components/MulticastStreamingToggles.tsx`
- `app/lib/shopify-upload.server.ts`

#### Step 3 — Pre-Flight Check
Route: `GET/POST /app/streams/new/preflight?streamId=...`

- On page load, **auto-creates the Mux Live Stream** if `Stream.muxStreamId` is missing.
  - sets Mux `latency_mode: "low"` (LL-HLS)
  - stores `muxStreamId`, `muxPlaybackId` (if available), `muxRtmpUrl`, `muxLatencyMode`
- Shows an “Advanced Settings” modal with:
  - RTMP server URL
  - stream key (from Mux API)
- “Start Streaming”:
  - sets `Stream.status = LIVE`
  - sets `Stream.startedAt` and `Stream.liveStartedAt` (for timer)
  - creates a `StreamEvent` (`STREAM_STARTED`)
  - navigates client-side to `/app/streams/:id/live` (avoids embedded-app redirect/session issues)

Primary file: `app/routes/app.streams.new.preflight.tsx`

---

### Live Streaming Control (Admin “/live” dashboard)
Route: `GET/POST /app/streams/:id/live`

- Provides the Week 2 “Go Live” control surface (UI is mostly scaffolded, but preview and end-stream are functional):
  - Stream Preview (LL-HLS playback via `hls.js`)
  - Live Chat (UI-only mock)
  - Product Control (UI-only mock)
  - Performance (UI-only mock)
- Stream Preview behavior:
  - Uses Redis state `stream:{id}:state === "live"` as “OBS is actually streaming”
  - Auto-detects:
    - **Mux playbackId** becoming available
    - **Redis live state** switching to `"live"`
  - Uses **conservative polling** via `useRevalidator()` every 5s only while waiting (to avoid prior auth-spam issues)
  - Once broadcasting, polling stops
- End Stream:
  - Uses a Polaris Modal (no browser `confirm()` prompt)
  - “End Stream” action sets:
    - `Stream.status = ENDED`, `Stream.endedAt = now`
    - creates `StreamEvent` (`STREAM_ENDED`)
  - then navigates back to `/app/streams`

Primary file: `app/routes/app.streams.$id.live.tsx`

---

## Architecture overview (Week 2)

### High-level “Go Live” flow

1. Merchant goes to Streams list: `/app/streams`
2. Merchant creates a stream:
   - Step 1: select products → creates `Stream(status=DRAFT)` + `StreamProduct[]`
   - Step 2: settings → updates stream metadata (title/tags/thumbnail/schedule)
3. Preflight loads:
   - Creates Mux live stream if needed (LL-HLS) and stores Mux identifiers on Stream
   - Shows RTMP server URL + stream key for OBS
4. Merchant clicks “Start Streaming” (admin-side intent):
   - Stream status is set to `LIVE`
   - Merchant then starts OBS streaming to RTMP
5. Mux webhooks + Redis:
   - When Mux becomes active, webhook sets Redis `stream:{id}:state = "live"`
6. Live control page auto-detects Redis “live” and starts HLS playback

### Embedded app navigation note (critical)
- The app persists `host` in `sessionStorage` inside `app/routes/app.tsx`.
- `ProductPickerButton` reads `host` from:
  - URL `?host=...` OR
  - `sessionStorage.shopifyHost`
- This prevents “URL changes but UI doesn’t update” / App Bridge context loss during client-side navigation.

Primary files:
- `app/routes/app.tsx`
- `app/components/ProductLineup.tsx`

---

## Important URLs / Routes

### Admin pages
- `GET /app/streams` — Streams list (tabs)
- `GET/POST /app/streams/new/products` — Wizard step 1 (product selection)
- `GET/POST /app/streams/new/settings?streamId=:id` — Wizard step 2 (settings)
- `GET/POST /app/streams/new/preflight?streamId=:id` — Wizard step 3 (preflight + RTMP)
- `GET/POST /app/streams/:id/live` — Live control + preview
- `GET /app/streams/:id` — Stream edit route (index route under `:id`)

### Webhooks
- `POST /webhooks/mux` — Mux webhook receiver

---

## Data model (Prisma) — Week 2 updates

Defined in `prisma/schema.prisma`.

### Stream (new / expanded fields)
- **Thumbnail**
  - `thumbnailUrl String?` — Shopify CDN URL stored after upload
- **Mux**
  - `muxLatencyMode String? @default("standard")`
    - used to track `"low"` for LL‑HLS streams
- **Tags**
  - `tags String[] @default([])`
- **Recurring (UI + persistence only)**
  - `isRecurring Boolean @default(false)`
  - `recurringFrequency String?` (`daily | weekly | monthly`)
- **Multi-cast (UI + persistence only)**
  - `multicastFacebook Boolean @default(false)`
  - `multicastInstagram Boolean @default(false)`
  - `multicastTiktok Boolean @default(false)`
- **Streaming preference (placeholder)**
  - `useOBS Boolean @default(true)`
- **Live timer support**
  - `liveStartedAt DateTime?`

---

## Redis keys (unchanged conceptually)

### Stream state
- `stream:{streamId}:state`
  - `"live"` when Mux webhook receives `video.live_stream.active`
  - `"ended"` when Mux webhook receives `video.live_stream.idle`

Redis client: `app/lib/redis.server.ts`

---

## Mux integration (Week 2 specifics)

### Preflight: create Mux live stream (LL‑HLS)
In `app/routes/app.streams.new.preflight.tsx` loader:
- When `stream.muxStreamId` is missing, creates a live stream:
  - `latency_mode: "low"` (LL‑HLS)
  - `playback_policy: ["public"]`
- Saves:
  - `muxStreamId`
  - `muxPlaybackId` (if present)
  - `muxRtmpUrl` (fallback to global endpoint if missing)
  - `muxLatencyMode = "low"`

### Playback URL
- HLS URL format:
  - `https://stream.mux.com/{playbackId}.m3u8`

### Webhooks
In `app/routes/webhooks.mux.tsx`:
- `video.live_stream.active`
  - sets Redis state `"live"`
  - updates DB Stream to `LIVE` and `startedAt = now`
  - attempts to capture playback ID (if present)
  - creates `StreamEvent(STREAM_STARTED)`
- `video.live_stream.idle`
  - sets Redis state `"ended"`
  - updates DB Stream to `ENDED` and `endedAt = now`
  - creates `StreamEvent(STREAM_ENDED)`
- `video.asset.ready`
  - extracts `playback_ids[0].id` and `live_stream_id`
  - updates `Stream.muxPlaybackId` if missing

Additional Mux events (connected/recording/disconnected/etc) are currently logged as “Unhandled”.

---

## LL‑HLS playback (Admin preview)

Live preview uses `hls.js` in `app/routes/app.streams.$id.live.tsx` with:
- `lowLatencyMode: true`
- small buffer targets + aggressive live-edge tracking
- live edge correction (jump forward if latency grows too large)
- basic error recovery for network/media errors

The UI also surfaces a computed latency estimate:
- \( latency \approx video.duration - video.currentTime \)

---

## Shopify Files thumbnail upload

In `app/lib/shopify-upload.server.ts`:
- Uses `stagedUploadsCreate` → POST to staged URL → `fileCreate`
- Implements retry loop because Shopify may return `image.url = null` initially while processing

Thumbnail UI:
- `app/components/ThumbnailUpload.tsx` centers the thumbnail preview in the card.

---

## Routing notes (important)

### Why `/app/streams/:id/live` works now
To support nested routes under `:id`, the stream detail route is implemented as an **index route**:
- `app/routes/app.streams.$id._index.tsx` → `/app/streams/:id`
- `app/routes/app.streams.$id.live.tsx` → `/app/streams/:id/live`

This prevents cases where the URL updates but UI appears “stuck” on the parent route.

---

## Known issues / follow-ups (Week 3 candidates)

### 1) Auth / session churn in development
During HMR and repeated loader revalidation, the logs may show repeated auth attempts, including `{shop: null}` in some transitions.

Mitigations in Week 2:
- avoid server-side redirects in sensitive embedded transitions (use client navigation)
- conservative polling (only when waiting for playback/live state)

### 2) “Start Streaming” semantics
Currently “Start Streaming” sets DB status to `LIVE` even though OBS may not be streaming yet.
This is intentional to unlock the live control page; actual broadcast is inferred via Redis state from Mux webhooks.

### 3) Live dashboard is mostly UI-only
Chat/product control/performance widgets are scaffolded and use mock data for now.

---

## Quick dev verification checklist (Week 2 milestone)

### Streams list
- Upcoming tab shows `DRAFT/SCHEDULED/LIVE` streams and correct count
- Past tab shows `ENDED` streams and correct count
- Past streams show mock stats + scheduled time, and no status badge

### Wizard
- Step 1: select products → lineup appears, drag reorder works
- Continue → creates stream and navigates to Step 2
- Step 2: set title/tags/thumbnail/schedule → Save Draft returns to Streams
- Next → navigates to Preflight

### Preflight + Mux
- Opening preflight auto-creates Mux stream if missing (RTMP values appear in Advanced Settings)
- Click “Start Streaming” → navigates to `/app/streams/:id/live`

### Live preview
- Before OBS starts: UI shows “waiting for video feed”
- Start OBS streaming to RTMP → within ~5s UI auto-detects and preview plays
- Stop OBS → webhook eventually sets Redis state ended; preview stops showing live state

### End stream
- Clicking “End Stream” shows a Polaris Modal (not browser confirm)
- Confirm → stream appears under Past streams

---

## File map (most relevant for Week 2)

- `app/routes/app.streams._index.tsx`
  - Streams list tabs + stream cards
- `app/routes/app.streams.new.products.tsx`
  - Wizard step 1: select products + create draft stream
- `app/routes/app.streams.new.settings.tsx`
  - Wizard step 2: title/tags/thumbnail/schedule + toggles (persisted)
- `app/routes/app.streams.new.preflight.tsx`
  - Wizard step 3: auto-create Mux live stream (LL‑HLS), show RTMP, start streaming (LIVE)
- `app/routes/app.streams.$id.live.tsx`
  - Live control page, auto-detect + LL‑HLS preview, End Stream modal
- `app/routes/app.streams.$id._index.tsx`
  - Stream detail/edit page (index route under `:id`)
- `app/routes/webhooks.mux.tsx`
  - Mux webhook processing (Redis + DB + StreamEvent)
- `app/lib/shopify-upload.server.ts`
  - Shopify Files upload helper (+ retry for CDN URL)
- `app/components/ProductLineup.tsx`
  - Resource Picker integration + DnD lineup for wizard
- `app/components/TagsInput.tsx`, `RecurringStreamToggle.tsx`, `MulticastStreamingToggles.tsx`, `ThumbnailUpload.tsx`
  - Reusable UI components used in wizard

