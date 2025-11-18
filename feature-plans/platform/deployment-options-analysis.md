# Deployment Options & Platform Validation  
*(Updated 18 Nov 2025)*

---

## 1. Plan vs Code Reality Check

| Platform Plan Claim | Current Repo Evidence | Status |
| --- | --- | --- |
| “WebSocket transport is production-ready; we’ll just swap transports later.” | `packages/server/src/hono/node/index.ts` wires `WebSocketEventSubscriber`, matching the plan. | ✅ Already implemented. |
| “EventBus cleans itself up so scale-to-zero is safe.” | `packages/core/src/events/index.ts:394-431` contains the `AbortSignal` cleanup. | ✅ Matches plan. |
| “MessageStreamManager + buffering exist already.” | `rg -n "MessageStreamManager" packages` → no hits. | ⚠️ Needs to be built. |
| “UserScopedStorage w/ RLS is ready.” | No references to `UserScopedStorage`. | ⚠️ Net-new work along with PostgreSQL RLS. |
| “GatewayLLMService + hosted billing loop already exist here.” | Billing logic only lives in `dexto-web/apps/api`; no client shim in this repo. | ⚠️ Need SDK + configuration. |
| “CostEstimator / ConcurrencyLimiter already ship.” | `rg` finds none. | ⚠️ Entire throttling stack is future work. |
| “HIL redesign is just plumbing.” | Only the spec file exists; no runtime code. | ⚠️ Track as a parallel epic. |

**Takeaway:** the architecture plan is sound, but nearly every new module still requires greenfield implementation before the platform can host paid tenants.

---

## 2. Hosting Capability Matrix

| Provider | WebSocket Support | Scale-to-Zero / Suspend | Compute Model | Built-in Observability | Notes |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Templates such as [Node WebSockets](https://railway.com/template/-8gWcb) and [Soketi](https://railway.com/template/QjOCUm) run WS apps out of the box. | [App Sleeping](https://docs.railway.com/reference/app-sleeping) pauses services after ~10 min idle and wakes them on demand. | Deploy via Docker/Nixpacks with per-second CPU+RAM billing ([pricing](https://railway.com/pricing)). | The new [Observability UI](https://railway.com/changelog/observability) provides CPU/RAM/network graphs per service. | Ideal baseline for MVP; sleep economics only work after SSE removes long-lived sockets. |
| **Fly.io** | [Docs](https://fly.io/docs/languages-and-frameworks/node/) explicitly show WebSocket apps on Fly Machines. | Machines can [auto-start/auto-stop](https://fly.io/docs/machines/guides/autostop-machines/) so idle runtimes hibernate. | Every app is a Docker-based Machine size (shared-cpu-1x/2x/8x, etc.). | [Metrics & Prometheus integration](https://fly.io/docs/reference/metrics/) ship by default. | Great for a pooled runtime with optional per-agent Machines when customers pay for isolation. |
| **Cloudflare Workers / Workers for Platforms** | Workers accept WebSocket upgrades via fetch/Durable Objects ([docs](https://developers.cloudflare.com/workers/runtime-apis/websockets/)). | Workers only bill for request + CPU time, so idle workloads naturally scale to zero ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)). | Event-driven JS/TS Workers and [Workers for Platforms](https://developers.cloudflare.com/workers/platform/workers-for-platforms/) for multi-tenant dispatch. | Cloudflare dashboard exposes per-tenant metrics (requests, CPU, errors). | Best for per-user/agent isolation without containers; stdio MCP/file access isn’t available. |
| **AWS ECS (Fargate)** | Application Load Balancer supports WebSocket upgrades ([AWS re:Post explanation](https://repost.aws/knowledge-center/elb-configure-websocket)). | Application Auto Scaling can scale services to zero by setting the desired count floor to 0 ([docs](https://docs.aws.amazon.com/autoscaling/application/userguide/what-is-application-auto-scaling.html)). | Docker images scheduled onto [Fargate](https://aws.amazon.com/fargate/pricing/) with per-second vCPU/GB billing. | [CloudWatch Container Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/ContainerInsights.html) provides dashboards/alarms. | Strong fit for enterprise isolation and VPC networking. |
| **AWS EC2** | Same ALB/WebSocket support as ECS; you manage the OS. | No native scale-to-zero—instances bill while `running` ([pricing overview](https://aws.amazon.com/ec2/pricing/on-demand/)). | Full VM control (Docker, GPUs, custom kernels). | CloudWatch metrics/logs per instance. | Cheapest when boxes stay fully utilized, but operations overhead is higher. |
| **Render** | [Render docs](https://docs.render.com/web-services#websockets) confirm WebSocket support for web services. | Free tier hibernates after 15 min; the paid “Hibernate” option lets services scale down when idle ([docs](https://docs.render.com/free#hibernation)). | Build from repo or Docker; billed per service ([pricing](https://render.com/pricing)). | Dashboard exposes CPU/RAM metrics, logs, and a cost breakdown per service. | Great DX but compute is pricier than Fly/Railway. |
| **Heroku** | Official [Heroku Dev Center article](https://devcenter.heroku.com/articles/websockets) covers WebSocket deployments (ActionCable, Socket.IO). | Eco dynos sleep after 30 min idle; Basic/Standard stay on 24/7 ([pricing](https://www.heroku.com/pricing)). | Buildpacks or container stack. | Runtime metrics + log drains available on paid tiers. | Simple developer experience but expensive at high agent counts. |

---

## 3. Cost & Pricing Analysis

### 3.1 Modeling Assumptions
1. Each *active* agent consumes **0.25 vCPU + 0.5 GB RAM** (current WebSocket footprint).
2. Only **10 %** of defined agents are simultaneously active on the “mega-service” (others idle).
3. Month length = **730 h** (Render’s billing convention).

This yields the following aggregate resource targets:

| Scenario | Defined Agents | Active Agents (10 %) | Aggregate CPU | Aggregate RAM |
| --- | --- | --- | --- | --- |
| S1 | 200 (100 users × 2 agents) | 20 | 5 vCPU | 10 GB |
| S2 | 10,000 (1k × 10) | 1,000 | 250 vCPU | 500 GB |
| S3 | 100,000 (10k × 10) | 10,000 | 2,500 vCPU | 5 TB |

### 3.2 Monthly Infrastructure Costs

| Provider | Architecture | S1 | S2 | S3 | Source |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Mega-service (always-on) | CPU: 5 vCPU × $0.00000772 × 2.592e6 s = $100.1; RAM: 10 GB × $0.00000386 × 2.592e6 s = $100.1 → **$200.2** | **$10,005** | **$100,051** | [Railway pricing](https://railway.com/pricing). |
|  | Per-agent container | $8.89/agent → **$1,778** | **$88,867** | **$888,675** | Same pricing as above. |
| **Fly.io** | Mega-service (shared-cpu presets) | 5 × shared-cpu-1x 2 GB ($10.70) = **$53.5** | 32 × shared-cpu-8x 16 GB ($85.59) ≈ **$2,739** | 313 × $85.59 ≈ **$26,793** | [Fly Machines pricing](https://fly.io/docs/reference/pricing/). |
|  | Per-agent (512 MB shared-cpu-1x) | 200 × $3.19 = **$638** | **$31,900** | **$319,000** | Same pricing as above. |
| **Cloudflare Workers / WfP** | Request/CPU usage (≈1 request/sec per active agent, 5 ms CPU/req). | 51.8 M req → [$0.30 per _extra_ 1 M req](https://developers.cloudflare.com/workers/platform/pricing/) = $9.5; CPU overage (199 M ms) at $0.02/M CPU‑ms = $4.0 + $25 base plan = **$38.5** | **$1.06 M** | **$10.36 M** | [Workers for Platforms pricing](https://developers.cloudflare.com/workers/platform/pricing/). |
| **AWS ECS (Fargate)** | Mega-service (resource-based) | 0.24685 $/h × 730 = **$180** | 12.3425 $/h × 730 = **$9,007** | 123.425 $/h × 730 = **$90,099** | [Fargate pricing](https://aws.amazon.com/fargate/pricing/). |
|  | Per-agent task | $0.0123425 $/h × 730 = **$9/agent** (→ $1,800 / $90k / $900k) | | | Same pricing as above. |
| **AWS EC2 (t3.small)** | Mega-service (t3.small 2 GB nodes) | 5 × $15.18 = **$75.9** | 250 × $15.18 = **$3,795** | 2,500 × $15.18 = **$37,950** | [EC2 on-demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/). |
|  | Per-agent (t3.nano) | 200 × $3.80 ≈ **$760** | **$38,000** | **$380,000** | Same source as above. |
| **Render** | Mega-service (Standard 2 GB) | 5 × $25 = **$125** | 250 × $25 = **$6,250** | 2,500 × $25 = **$62,500** | [Render pricing](https://render.com/pricing). |
|  | Per-agent (Starter 512 MB) | 200 × $7 = **$1,400** | **$70,000** | **$700,000** | Same source. |
| **Heroku** | Mega-service (Standard‑1X 512 MB dynos) | Need 20 dynos → **$500** | 1,000 dynos → **$25,000** | 10,000 dynos → **$250,000** | [Heroku pricing](https://www.heroku.com/pricing). |
|  | Per-agent (Basic dyno) | 200 × $7 = **$1,400** | **$70,000** | **$700,000** | Same source. |

> Cloudflare costs scale with traffic rather than agent count. If an agent emits fewer than ~10 k requests per month it effectively fits inside the Workers for Platforms free allocation.

### 3.4 Per-Agent Price Guidance

- **Railway dedicated agent** – Infra ≈ $9/agent-month; charge **$15–$18** to cover observability + support overhead. (Source: [Railway pricing](https://railway.com/pricing))
- **Fly Machine** – 512 MB shared-cpu-1x = $3.19; after bandwidth/support, price at **≈$12**. ([Fly pricing](https://fly.io/docs/reference/pricing/))
- **Cloudflare Edge agent** – 10 k requests/month fits in Workers’ included quota, so a **$5 SKU** is mostly margin (throttle heavy users). ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/))
- **Fargate / EC2 premium isolation** – $9 (Fargate) or $15 (t3.small) raw cost justifies **$100–$250 enterprise SKUs** when factoring VPC peering and SLAs. ([Fargate pricing](https://aws.amazon.com/fargate/pricing/); [EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/))
- **Render / Heroku** – Starter/Basic dynos are $7, so reselling below **$15** erodes margin; reserve these platforms for customers paying for DX rather than low cost. ([Render pricing](https://render.com/pricing); [Heroku pricing](https://www.heroku.com/pricing))

---

## 4. Comparison with the SSE Migration Plan

The WebSocket → SSE plan in `../core-migration/websocket-to-sse-migration-2.md` (Section 6) shows Railway dropping from **$513/mo** (WebSockets) to **$9/mo** for 100 users once long-lived sockets disappear and the platform can sleep. Our hosting analysis mirrors that story:

- **Railway & Fly.io:** Billing is tied to wall-clock runtime. WebSockets force “always-on” services (costs in §3.2), while SSE allows App Sleeping / auto-stop to deliver the 57–153× savings promised in the SSE plan.
- **Cloudflare Workers:** Already request-priced, so SSE mainly improves developer ergonomics (fetch + ReadableStream) and avoids paying Workers Unbound wall-clock duration for open WebSockets.
- **AWS ECS/Fargate:** SSE lets you terminate tasks between messages and rely on target tracking (min capacity 0) instead of keeping 24/7 WebSocket workers alive.

**Bottom line:** Ship SSE before relying on Railway’s “$9/mo” marketing. Until then, budget using the “WebSocket (always-on)” numbers above.

---

## 5. Recommendations

1. **Finish the blocking platform modules first.** MessageStreamManager, storage/RLS, gateway client, throttling, and HIL redesign are prerequisites regardless of host.
2. **Use Railway for the MVP but budget conservatively** (using the always-on numbers) until SSE lands. After SSE, re-baseline costs using the migration plan’s projections.
3. **Pilot Fly.io and ECS in parallel.** Fly serves the cheapest pooled runtime with optional auto-stop Machines; ECS validates per-tenant isolation and AWS residency for enterprise deals.
4. **Offer priced tiers per provider** (e.g., “Shared Railway agent = $15/mo”, “Dedicated Fly Machine = $12/mo”, “Edge agent on Cloudflare = $5/mo”, “Isolated AWS agent = $150/mo”) so customers can choose isolation vs. cost.
5. **Document when to choose Cloudflare Workers.** They’re ideal for request-based agents without stdio MCP/file access. For tool-heavy agents that need filesystem access, stick to Railway/Fly/AWS.
6. **Re-run this analysis post-SSE** with real telemetry to verify the expected 57–153× savings before declaring WebSockets deprecated in marketing material.
