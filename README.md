# OpenVitals

**Your Google Health data as a self-hosted MCP server** — so any AI client (Claude, or anything that speaks [MCP](https://modelcontextprotocol.io)) can read your heart rate, sleep, workouts, nutrition, body metrics and more, and reason over them for you.

It's a small Node server. It pulls your data from the Google Health API, keeps it in a local SQLite file, and exposes ~60 tools over `POST /mcp` behind a bearer token.

---

## Why? Because Google's AI is too costly

Google will happily analyze your health data for you — behind a paid product. As an individual (not a company) you don't want a subscription just to ask *"how did I sleep this week vs. last?"*.

OpenVitals flips it around: **you** own a free Google Cloud project, **you** hold the OAuth secrets, and your data stays on **your** machine. The "AI" is whatever MCP client you already have. No per-query bill, no data leaving your box.

---

## How it works

```
Google Health API  ──►  OpenVitals server  ──►  SQLite (your machine)
   (your data)         (always-on device)              │
                                                        ▼
                              your AI client  ◄──  POST /mcp  (bearer token)
                            (Claude, etc.)        localhost, or a public URL
```

Three things you need:

1. **A continuous / always-on device.** The server has to be running for your AI client to reach it and to sync fresh data from Google Health. A spare laptop, a Raspberry Pi, a mini-PC — anything that stays on. (This repo runs on a laptop-as-homelab-server.)

2. **Your own Google Cloud + Health secrets.** You are not a company and shouldn't pay enterprise prices — so you create a **free** Google Cloud OAuth client yourself and drop the secret file in place. OpenVitals uses it to log in to *your* Google Health account with read-only scopes. Nothing is shared with anyone.

3. **(Optional) A domain + a tunnel for a public URL.** By default the server only listens on `127.0.0.1`, so it works from the same machine. If you want to reach it from your phone or a cloud AI, and you have a domain, point a **Cloudflare Tunnel** (or Tailscale, ngrok, an SSH tunnel — any method) at the local port. No open ports on your router.

---

## Setup

### Prerequisites
- **Node 22+** (uses the built-in `node:sqlite`).
- A Google account with data in Google Health.

### 1. Create your Google Cloud secrets (free)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create a **new project** (free).
2. **APIs & Services → Enable APIs** → enable the **Google Health API**.
3. **OAuth consent screen** → **External** → add your own Google account as a **Test user** (so you don't need Google verification for personal use).
4. Add these **read-only** scopes (OpenVitals never asks for write access):
   ```
   openid  profile
   googlehealth.activity_and_fitness.readonly
   googlehealth.health_metrics_and_measurements.readonly
   googlehealth.nutrition.readonly
   googlehealth.profile.readonly
   googlehealth.sleep.readonly
   googlehealth.ecg.readonly
   googlehealth.irn.readonly
   googlehealth.location.readonly
   googlehealth.settings.readonly
   ```
5. **Credentials → Create credentials → OAuth client ID → Desktop app** (or Web).
6. Add this **Authorized redirect URI**:
   ```
   http://127.0.0.1:42813/oauth/callback
   ```
7. **Download** the client JSON and save it here:
   ```
   ~/.hermes/secrets/google-health-client.json
   ```
   (or put it anywhere and point `GOOGLE_HEALTH_SECRETS` at it).

### 2. Install & run the server

```bash
git clone https://github.com/saiteja007-mv/openvitals.git
cd openvitals
npm install
npm run build        # builds the web UI
npm run server       # starts on http://127.0.0.1:42815
```

### 3. Connect your Google Health account (one-time)

Do the OAuth login once to authorize OpenVitals. This stores a **refresh token** in:
```
.data/google-health-credentials.json
```
From then on the server refreshes the token automatically — no repeated logins. Trigger a data pull any time with the `sync_google_health` tool or `POST /api/sync`.

> Tip: if a login is rejected, disconnect any datacenter VPN first — Google blocks OAuth from datacenter exit IPs.

### 4. Connect your AI client to the MCP

Grab the bearer token the server generated:
```bash
cat .data/mcp-token.txt
```

Point your MCP client at the endpoint with that token:

- **Endpoint:** `http://127.0.0.1:42815/mcp`
- **Auth:** `Authorization: Bearer <token>`

Example Claude Code entry:
```bash
claude mcp add --transport http openvitals http://127.0.0.1:42815/mcp \
  --header "Authorization: Bearer <token>"
```

Ask your AI things like *"summarize my sleep this week"*, *"how many calories am I averaging?"*, *"log a 5 km run"*.

### 5. (Optional) Expose it with a public URL

If you have a domain and want to reach OpenVitals from anywhere (e.g. a cloud AI or your phone):

```bash
# Cloudflare Tunnel — maps a hostname to the local port, no router changes
cloudflared tunnel --url http://127.0.0.1:42815
```
Then use `https://health.yourdomain.com/mcp` as the endpoint instead of localhost. Tailscale, ngrok, or an SSH reverse tunnel work just as well.

> Some MCP connector UIs have no header field. If so, pass the token in the URL: `https://health.yourdomain.com/mcp?token=<token>`.

---

## Configuration (env vars)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `42815` | Port the server listens on |
| `GOOGLE_HEALTH_SECRETS` | `~/.hermes/secrets/google-health-client.json` | Path to your Google OAuth client JSON |
| `HEALTH_MCP_GH_CREDENTIALS` | `.data/google-health-credentials.json` | Where the stored Google token lives |
| `HEALTH_MCP_DB` | `.data/health-mcp.sqlite` | SQLite database path |
| `HEALTH_MCP_TOKEN` | auto-generated → `.data/mcp-token.txt` | Bearer token for `/mcp` |
| `HEALTH_MCP_PASSWORD` | auto-generated | Password for the web UI |
| `HEALTH_MCP_HEALTH_TTL_MS` | `60000` | How long Google Health responses are cached |
| `HEALTH_MCP_NO_AUTH` | unset | Set to disable auth (local dev only — never expose this) |

## What you can do (~60 MCP tools)

- **Google Health** — heart, sleep, activity, glucose, SpO₂, temperature, breathing, body composition, ECG, daily/weekly summaries
- **Nutrition** — log meals, search foods, barcode lookup, recipes, intake vs. plan
- **Workouts** — log workouts, workout plans, exercise search
- **Body metrics** — weight and other measurements over time
- **Habits & reminders** — track habits, get due reminders
- **Insights** — progress, recommendations, plan-vs-logged comparisons

## Security notes

- Everything sensitive stays local and is **gitignored**: `.data/` (your DB, tokens, password, TLS) is never committed.
- Scopes are **read-only** on the Google side.
- If you expose a public URL, the bearer token is the only thing guarding your data — keep it secret, and prefer a tunnel over opening a router port.

## Disclaimer

OpenVitals is a personal project, not a medical device. Not affiliated with Google. Don't make medical decisions from it.
