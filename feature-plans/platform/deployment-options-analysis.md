# Deployment Options & Platform Validation (Updated 18 Nov 2025)

## 1. Plan vs Code Audit (Reality Check)

| Platform Plan Claim | Repo Source of Truth | Status |
| --- | --- | --- |
| “WebSocket transport is production-ready; we’ll just swap transports later.” | `packages/server/src/hono/node/index.ts` contains the HTTP server + `WebSocketEventSubscriber`, matching the plan’s assumption. | ✅ |
| “EventBus already cleans itself up so scale-to-zero is safe.” | `packages/core/src/events/index.ts:394-431` shows the `AbortSignal` logic the plan cites. | ✅ |
| “MessageStreamManager + server-side buffering already exist.” | `rg -n "MessageStreamManager" packages` returns nothing. | ⚠️ Net-new server module. |
| “UserScopedStorage is already wired up.” | No references to `UserScopedStorage` in the repo. | ⚠️ Needs to be implemented alongside PostgreSQL RLS. |
| “GatewayLLMService / hosted billing client already exist.” | Billing logic lives in `dexto-web/apps/api`, but no client shim exists here. | ⚠️ SDK + config work required. |
| “CostEstimator + ConcurrencyLimiter are ready.” | `rg` for both names returns nothing. | ⚠️ Entire throttling subsystem is future work. |
| “HIL redesign is just integration work.” | Only the spec file exists; no runtime code. | ⚠️ Parallel epic. |

**Takeaway:** The architecture is sound, but most critical modules remain unimplemented. Treat these as blockers before onboarding multi-tenant customers.

## 2. Hosting Capability Matrix

| Provider | WebSockets | Scale-to-Zero / Suspend | Compute Model | Built-in Observability | Notes |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Templates (Node + Socket.IO, Soketi, etc.) deploy WS servers out of the box. citeturn6search0 | “Serverless” / App Sleeping pauses services after ~10 minutes idle and wakes on demand. citeturn6search2 | Deploy via Docker/Nixpacks with per-second CPU+RAM billing. citeturn6search1 | New observability view exposes CPU/RAM/network graphs + deploy history. citeturn8search1 | Ideal baseline for the SSE plan; sleep only works once sockets disappear. |
| **Fly.io** | Docs explicitly show WebSocket apps running on Fly Machines. citeturn7search2 | `auto_stop_machines` and the autoscaler blueprint suspend idle Machines. citeturn7search4 | Every app is a Docker-based Machine size (shared-cpu-1x, 2x, 8x, etc.). citeturn7search0 | Prometheus/metrics endpoints ship by default. citeturn7search3 | Great for pooled runtimes with optional per-agent Machines when customers pay for isolation. |
| **Cloudflare Workers / Workers for Platforms** | Workers + Durable Objects accept WebSocket upgrades via `fetch`/`serverws`. citeturn9search3 | Billing is per-request and per-CPU millisecond; idle time is free so workloads inherently scale to zero. citeturn9search1 | Event-driven JS/TS Workers plus Workers for Platforms routing tenants to their own Workers. citeturn9search2 | Workers dashboard exposes per-tenant metrics (requests, CPU, errors). citeturn9search2 | Best for per-user/agent isolation when stdio MCP isn’t required. |
| **AWS ECS (Fargate)** | ALB in front of ECS services supports WebSocket upgrades. citeturn10search2 | Application Auto Scaling can set desired count to 0, letting services scale to zero and spin back up on demand. citeturn10search1 | Docker images scheduled onto serverless Fargate with per-second CPU/RAM billing. citeturn10search0 | CloudWatch Container Insights provides dashboards + alarms. citeturn10search3 | Strong fit for enterprise isolation + VPC networking. |
| **AWS EC2** | Same ALB/WebSocket model; you manage the OS yourself. citeturn10search2 | No native scale-to-zero—instances bill while `running`. citeturn12search4 | Full VM control (Docker, GPUs, custom kernels). | CloudWatch metrics/logs per instance. citeturn12search6 | Cheapest when boxes stay fully utilized. |
| **Render** | Render documents WebSocket deployments for long-lived connections. citeturn11search0 | Free tier hibernates after 15 min; Starter/Standard stay warm, while “Render Hibernate” option lets paid services scale down. citeturn11search1 | Build from repo or Docker; billed per-instance. citeturn11search0 | Dashboard shows CPU/RAM/time-series and billing per service. citeturn11search2 | Best DX, but pricier for sustained loads. |
| **Heroku** | Official docs cover WebSockets (Action Cable, Socket.IO). citeturn12search0 | Eco dynos sleep after 30 min; Basic/Standard stay on 24/7. citeturn12search1 | Buildpacks or container stack. | Runtime metrics + log drains on paid tiers. citeturn12search1 | Simple developer experience but expensive at high agent counts. |

## 3. Cost & Pricing Analysis

### 3.1 Modeling Assumptions
- Per active agent: **0.25 vCPU + 0.5 GB RAM** (current WebSocket footprint).
- **10 %** of defined agents are active simultaneously to size shared runtimes.
- Month = **730 hours** (Render’s billing convention). citeturn11search0

### 3.2 Scenario Resource Targets
| Scenario | Defined Agents | Active Agents (10 %) | Aggregate CPU | Aggregate RAM |
| --- | --- | --- | --- | --- |
| S1 | 200 (100 users × 2 agents) | 20 | 5 vCPU | 10 GB |
| S2 | 10,000 (1k × 10) | 1,000 | 250 vCPU | 500 GB |
| S3 | 100,000 (10k × 10) | 10,000 | 2,500 vCPU | 5 TB |

### 3.3 Monthly Infrastructure Cost Estimates
| Provider | Architecture | S1 | S2 | S3 | Pricing Source |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Mega-service (always-on) | CPU: 5 vCPU × $0.00000772 × 2.592e6 s = $100.1; RAM: 10 GB × $0.00000386 × 2.592e6 s = $100.1 → **$200.2** | **$10,005** | **$100,051** | Per-second CPU/RAM pricing. citeturn6search1 |
|  | Per-agent container | $8.89/agent → **$1,778** | **$88,867** | **$888,675** | citeturn6search1 |
| **Fly.io** | Mega-service (shared-cpu presets) | 5 × shared-cpu-1x 2 GB ($10.70) = **$53.5** | 32 × shared-cpu-8x 16 GB ($85.59) = **$2,739** | 313 × $85.59 = **$26,793** | Machine pricing. citeturn7search0 |
|  | Per-agent (512 MB shared-cpu-1x) | 200 × $3.19 = **$638** | **$31,900** | **$319,000** | citeturn7search0 |
| **Cloudflare Workers / Workers for Platforms** | Request/CPU usage (assume 1 request/sec per active agent, 5 ms CPU/req). | S1: 51.8 M req → (51.8M−20M)/1M×$0.30 ≈ $9.5; CPU overage (259 M ms−60 M)/1M×$0.02 ≈ $4.0 + $25 base = **$38.5** | S2: 2.592 B req → $774.6 (requests) + $258.6 (CPU) + $25 = **$1.06 M** | S3: 25.92 B req → $7.77 M + $2.59 M + $25 = **$10.36 M** | Workers/Workers for Platforms pricing. citeturn9search1turn9search2 |
| **AWS ECS (Fargate)** | Mega-service (resource-based) | 0.24685 $/h × 730 = **$180** | 12.3425 $/h × 730 = **$9,007** | 123.425 $/h × 730 = **$90,099** | Fargate vCPU/GB pricing. citeturn10search0 |
|  | Per-agent task (0.25 vCPU/0.5 GB) | $0.0123425 $/h × 730 = **$9/agent** (→ $1,800 / $90k / $900k) | | | citeturn10search0 |
| **AWS EC2 (t3.small)** | Mega-service (t3.small 2 GB nodes) | 5 × $15.18 = **$75.9** | 250 × $15.18 = **$3,795** | 2,500 × $15.18 = **$37,950** | On-demand pricing. citeturn6search2 |
|  | Per-agent (t3.nano) | 200 × $3.80 ≈ **$760** | **$38,000** | **$380,000** | On-demand pricing. citeturn6search6 |
| **Render** | Mega-service (Standard 2 GB) | 5 × $25 = **$125** | 250 × $25 = **$6,250** | 2,500 × $25 = **$62,500** | Instance pricing. citeturn11search0 |
|  | Per-agent (Starter 512 MB) | 200 × $7 = **$1,400** | **$70,000** | **$700,000** | citeturn11search0 |
| **Heroku** | Mega-service (Standard-1X 512 MB dynos) | Need 20 dynos → **$500** | 1,000 dynos → **$25,000** | 10,000 → **$250,000** | Dyno pricing. citeturn12search1 |
|  | Per-agent (Basic dyno) | 200 × $7 = **$1,400** | **$70,000** | **$700,000** | citeturn12search1 |

> Cloudflare costs scale with traffic rather than agent count; if agents stream less than 1 req/sec the totals drop proportionally.

### 3.4 Per-Agent Price Guidance
- **Railway Dedicated Agent:** Infra ≈ $9/agent-month; charge $15–$18 to cover observability + credit card fees. citeturn6search1
- **Fly Machine:** 512 MB shared-cpu-1x = $3.19; after bandwidth/support overhead, $12/agent leaves margin. citeturn7search0
- **Cloudflare Edge Agent:** 10k req/month stays within Workers included quota, so a $5 SKU is mostly margin; publish throttles for heavy use. citeturn9search1turn9search2
- **Fargate / EC2 Premium Isolation:** $9 (Fargate) or $15 (t3.small) raw cost justifies $100–$250 enterprise SKUs with VPC isolation + SLAs. citeturn10search0turn6search2
- **Render/Heroku:** Starter/Basic is $7, so reselling below $15 erodes margin; reserve for customers paying for DX rather than low cost. citeturn11search0turn12search1

## 4. Alignment with the SSE Migration Plan
- The SSE migration plan (`../core-migration/websocket-to-sse-migration-2.md`, Section 6) projects Railway dropping from **$513/mo** (WebSockets) to **$9/mo** for 100 users once connections become request/response; our analysis shows the same per-second pricing pressure—Railway/Fly only realize savings when idle services can sleep. citeturn6search1turn7search4
- Cloudflare Workers already bills on request/CPU units, so adopting SSE mainly improves developer ergonomics (fetch + ReadableStream) while avoiding the Workers Unbound gotcha of paying wall-clock duration for long WebSockets. citeturn9search3turn9search1
- On ECS/Fargate, SSE lets you terminate tasks between messages and rely on target tracking (min capacity 0) instead of keeping 24/7 WebSocket workers alive. citeturn10search1turn10search2

## 5. Recommendations
1. **Finish the open platform work items first.** MessageStreamManager, UserScopedStorage/RLS, gateway client, throttling, and HIL redesign are required before adding tenants.
2. **Use Railway for the MVP but budget using the “always-on” numbers above** until SSE ships; once SSE lands you can lean on the migration plan’s $9/month expectation.
3. **Pilot Fly.io and ECS in parallel.** Fly gives the cheapest shared runtime with optional auto-stop Machines; ECS validates per-tenant isolation and AWS residency for enterprise deals.
4. **Offer priced tiers per provider.** Example: “Shared Railway agent = $15/mo”, “Dedicated Fly Machine = $12/mo”, “Edge Workers agent = $5/mo”, “Isolated AWS agent = $150/mo”.
5. **Document when to choose Cloudflare Workers.** They’re ideal for per-tenant isolation without containers but lack stdio MCP/filesystem access.
6. **Revisit hosting once SSE is live.** After the SSE migration, re-run this analysis with real telemetry to verify the promised 57–153× savings before removing WebSockets entirely.
