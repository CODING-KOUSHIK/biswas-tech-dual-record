# Biswas Tech Dual Recording Studio

Production-ready dual voice recording platform for AI speech data collection.  
Built with **Next.js 16**, **TypeScript**, **LiveKit Cloud**, **Web Audio API**, **Upstash Redis**, and **Vercel**.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Quick Start (Local)](#quick-start-local)
- [Environment Variables](#environment-variables)
- [Services Setup](#services-setup)
- [Deploy to Vercel](#deploy-to-vercel)
- [Recording Format](#recording-format)
- [User Flow](#user-flow)
- [Security](#security)

---

## Architecture Overview

```
Browser                 Vercel (Server)          External Services
──────                  ───────────────          ─────────────────
Login Form        →     /api/auth/login     →    Upstash Redis (user lookup)
                        JWT cookie ←

Dashboard         →     /api/host/room      →    Generate room ID
                        /api/livekit/token  →    livekit-server-sdk (JWT)
                        LiveKit token ←

RoomClient        →     wss://livekit.cloud →    LiveKit Cloud (audio relay)
AudioWorklet            (direct WebSocket)
IndexedDB
```

**Key principle**: `LIVEKIT_API_SECRET` only lives on the server. The browser only receives a short-lived JWT token. `LIVEKIT_URL` is returned in the token API response — no `NEXT_PUBLIC_` env var is needed.

---

## Quick Start (Local)

### 1. Clone

```bash
git clone https://github.com/CODING-KOUSHIK/biswas-tech-dual-record.git
cd biswas-tech-dual-record
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in **all** values (see [Environment Variables](#environment-variables) below).

### 3. Run development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to the login page.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LIVEKIT_URL` | ✅ | LiveKit WebSocket URL e.g. `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` | ✅ | LiveKit API key (server-only) |
| `LIVEKIT_API_SECRET` | ✅ | LiveKit API secret — **never expose to browser** |
| `SESSION_SECRET` | ✅ | 32+ char random string for JWT signing |
| `HOST_USER_ID` | ✅ | Host login username |
| `HOST_PASSWORD` | ✅ | Host login password |
| `HOST_GENDER` | ✅ | `MALE` or `FEMALE` |
| `HOST_LANGUAGE` | ✅ | Language code e.g. `EN`, `HI` |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis REST token |

> **Security note**: `LIVEKIT_API_SECRET` is used only inside `lib/livekit.ts` which is decorated with `import 'server-only'`. Next.js will throw a build error if this file is ever imported by client components.

Generate a session secret:
```bash
openssl rand -base64 32
```

---

## Services Setup

### LiveKit Cloud

1. Go to [cloud.livekit.io](https://cloud.livekit.io) and create an account
2. Create a new project
3. Copy **WebSocket URL**, **API Key**, and **API Secret**
4. Set them as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`

### Upstash Redis

**Option A — Upstash Console:**
1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a new Redis database (free tier works)
3. Copy **REST URL** and **REST Token**

**Option B — Vercel Marketplace (recommended for Vercel deploys):**
1. In your Vercel project → **Storage** tab → **Create Database** → **Upstash Redis**
2. Variables are added automatically to your Vercel project

---

## Deploy to Vercel

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "feat: production-ready LiveKit integration"
git push origin main
```

> ⚠️ `.env.local` is in `.gitignore`. It will **never** be pushed to GitHub.

### Step 2 — Import on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** → select `biswas-tech-dual-record`
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy** — the first build will fail (missing env vars — that's expected)

### Step 3 — Add environment variables

In your Vercel project → **Settings** → **Environment Variables**, add:

| Name | Value |
|---|---|
| `LIVEKIT_URL` | `wss://biswas-tech-pyf2vwvf.livekit.cloud` |
| `LIVEKIT_API_KEY` | your LiveKit API key |
| `LIVEKIT_API_SECRET` | your LiveKit API secret |
| `SESSION_SECRET` | 32+ char random string |
| `HOST_USER_ID` | your chosen host username |
| `HOST_PASSWORD` | your chosen host password |
| `HOST_GENDER` | `MALE` or `FEMALE` |
| `HOST_LANGUAGE` | `EN` |
| `UPSTASH_REDIS_REST_URL` | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash |

### Step 4 — Redeploy

Trigger a new deployment via the Vercel dashboard or:

```bash
git commit --allow-empty -m "trigger: redeploy with env vars"
git push
```

### Step 5 — Verify

```
https://your-project.vercel.app/login
```

Log in with your `HOST_USER_ID` / `HOST_PASSWORD`.

---

## Token API

### `POST /api/livekit/token`

Generates a LiveKit access token. Requires authenticated session.

**Request body:**
```json
{
  "roomName": "btd_host_48215",
  "participantIdentity": "host_A9F2",
  "participantName": "Host"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "<LiveKit JWT>",
    "url": "wss://biswas-tech-pyf2vwvf.livekit.cloud"
  }
}
```

Token expires in **1 hour**. Grants: `roomJoin`, `canPublish`, `canSubscribe`, `canPublishData`.

The `url` field is returned so the client never needs to know `LIVEKIT_URL` directly — no `NEXT_PUBLIC_` variable is required.

---

## Recording Format

| Property | Value |
|---|---|
| Format | WAV (RIFF) |
| Sample Rate | 44100 Hz |
| Bit Depth | 16-bit PCM |
| Channels | Mono |
| Engine | Web Audio API AudioWorklet (not MediaRecorder) |

### File Naming

```
{DeviceID}_{LANGUAGE}_{GENDER}_{ROLE}_{PairID}.wav

Examples:
A9F2_EN_MALE_HOST_48215.wav
X7K3_HI_FEMALE_GUEST_48215.wav
```

### ZIP Structure

```
Meeting_48215/
  A9F2_EN_MALE_HOST_48215.wav
  X7K3_HI_FEMALE_GUEST_48215.wav
  metadata.json
```

---

## User Flow

### Host

```
1. Login at /login (HOST_USER_ID / HOST_PASSWORD)
2. Dashboard → "Enter Recording Room"
3. Dashboard → "Invite User" → select partner gender → copy link
4. Share invite link with partner
5. In room: wait for partner → "Start Recording"
6. Partner recording auto-transferred via P2P data channel
7. Dashboard → "Recording Files" → Download pair ZIP
```

### Guest (Partner)

```
1. Open invite link (no account required)
2. Allow microphone access
3. Auto-joins room
4. When recording stops → WAV is sent to host automatically
```

---

## Security

| Feature | Implementation |
|---|---|
| API secret isolation | `import 'server-only'` in `lib/livekit.ts` |
| Session security | `httpOnly`, `secure`, `SameSite=lax` cookies |
| Token expiry | 1 hour LiveKit JWT |
| Single-device lock | Device ID bound to account in Redis |
| Rate limiting | 5 login attempts/min via Upstash Redis |
| Input validation | All API inputs sanitized and validated |
| No audio cloud storage | All WAV files stored locally in IndexedDB |
| P2P transfer | Guest WAV → Host via LiveKit data channel (no server) |

---

## Local Development Notes

- **HTTPS not required locally** — LiveKit works over `localhost` with `ws://`
- **Microphone permission** is verified before the room connects
- **Single tab** is enforced via BroadcastChannel API
- **Wake Lock** prevents screen sleep during recording (Chrome/Edge/Android)

---

## npm run build

```bash
npm run build
```

Must complete with:
- ✅ 0 TypeScript errors
- ✅ 0 ESLint errors  
- ✅ All routes compiled successfully
