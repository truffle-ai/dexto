# Deployment Options & Platform Validation (Updated 18 Nov 2025)

## 1. Plan vs Code Audit (Reality Check)

| Platform Plan Claim | Repo Source of Truth | Status |
| --- | --- | --- |
| “WebSocket transport is production-ready; we’ll just swap transports later.” | `packages/server/src/hono/node/index.ts` contains the HTTP server + `WebSocketEventSubscriber`, matching the plan’s assumption. | ✅ |
| “EventBus already cleans itself up so scale-to-zero is safe.” | `packages/core/src/events/index.ts:394-431` shows the `AbortSignal` logic the plan cites. | ✅ |
| “MessageStreamManager + server-side buffering already exist.” | `rg -n "MessageStreamManager" packages` returns nothing. | ⚠️ Net-new server module. |
| “UserScopedStorage is already wired up.” | No references to `UserScopedStorage` in the repo. | ⚠️ Needs to be implemented alongside the planned PostgreSQL RLS work. |
| “GatewayLLMService / hosted billing client already exist.” | Gateway logic exists only in `dexto-web/apps/api`; no client shim in this repo. | ⚠️ Need SDK + config wiring. |
| “CostEstimator + ConcurrencyLimiter are ready.” | `rg` for both names returns nothing. | ⚠️ Entire throttling subsystem is future work. |
| “HIL redesign is just integration work.” | Only the plan file exists; zero runtime code. | ⚠️ Track as a parallel epic. |

**Takeaway:** The plan’s architecture is sound, but almost every “new” module remains unimplemented. Treat these as blockers before onboarding paying tenants.

## 2. Hosting Capability Matrix

| Provider | WebSockets | Scale-to-Zero / Suspend | Compute Model | Built-in Observability | Notes |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Standard Node templates (e.g., Soketi WebSockets) run without extra config, so WS is supported. citeturn18open0 | Apps can auto-sleep after 15 minutes idle when enabled. citeturn3search2 | Docker or Nix deploy; pricing is per vCPU-second + GB-second. citeturn16open0 | CPU/RAM/Network graphs plus deploy history out of the box. citeturn17open0 | Best for our OSS stack; SSE plan assumes Railway as the baseline. |
| **Fly.io** | WebSockets are explicitly supported in Fly’s “Deploy Your Own” guidance. citeturn4open0 | Machines can `auto_stop` and hibernate, rehydrating on demand. citeturn0search5 | Every app is a Docker container; shared-cpu-1x/2x/8x sizes. citeturn4open0 | Exposes Prometheus endpoints + autoscaler blueprints. citeturn0search6 | Strong fit for pooled runtimes; global Anycast LBs keep latency low. |
| **AWS ECS (Fargate)** | Put services behind an ALB; ALB natively supports WebSocket upgrades. citeturn6open0 | Target-tracking auto scaling can reduce desired tasks to 0 (cold-starts handled by ALB). citeturn8search9 | Docker images scheduled onto serverless Fargate. citeturn5open0 | CloudWatch Container Insights dashboards + alarms. citeturn3search5 | Best option for enterprise isolation or AWS data residency. |
| **AWS EC2 (raw)** | Same ALB/WebSocket support as ECS; you manage the OS yourself. citeturn6open0 | No native scale-to-zero—instances bill while `running`. citeturn12search4 | Full VM control (Docker, custom kernels, GPUs). | Instance + VPC metrics via CloudWatch. citeturn12search6 | Cheapest when workloads are fully saturated and stable. |
| **Render** | Web services explicitly support WebSockets. citeturn9open0 | Free tier hibernates after 15 min idle; paid tiers stay warm but you can use the Hibernate (scale-to-zero) stack. citeturn5search0turn5search7 | Build from repo or deploy Docker images. citeturn10open0 | Built-in dashboards showing CPU/RAM, deploys, and logs. citeturn6search2turn6search4 | Great DX, but compute is pricier than Fly/Railway. |
| **Heroku** | Official docs cover ActionCable / Socket.IO deployments. citeturn11open0 | Eco dynos sleep after 30 min; paid dynos stay on. citeturn12open0 | Buildpacks or container stack. | Metrics + log drains (Datadog, New Relic). | Still easiest for small teams, but expensive at scale. |
| **Cloudflare Workers / Workers for Platforms** | Workers support fetch upgrades and Durable Objects, so WebSockets + SSE are first-class. citeturn14open0 | Containers hibernate automatically; billing pauses when the Worker is idle. citeturn13open0turn15open0 | Serverless JavaScript/TypeScript (or `workers-for-platforms` containers) instead of Docker VMs. citeturn19open0 | Workers for Platforms expose per-tenant analytics via existing Cloudflare dashboards. citeturn13open0 | Excellent for per-tenant isolation, but no traditional container runtime. |

## 3. Cost & Pricing Analysis

### 3.1 Modeling Assumptions

- **Resource envelope per active agent:** 0.25 vCPU + 0.5 GB RAM (matches our WebSocket runtime footprint).
- **Concurrency:** At any moment ~10% of defined agents are active (the rest idle waiting on inbound requests). This keeps shared runtimes from being sized for worst-case.
- **Month length:** 730 hours (Render bills this way). citeturn10open0
- **Cloudflare usage model:** Assume each agent handles 50k Worker requests/month with 5 ms CPU time (lightweight chat relays).

### 3.2 Scenario Costs (Monthly)

| Provider | Architecture | S1: 100 users / 2 agents | S2: 1k users / 10 agents | S3: 10k users / 10 agents | Source |
| --- | --- | --- | --- | --- | --- |
| **Railway** | Mega-service (always-on) | $200 (5 vCPU + 10 GB at per-second rates) | $10,005 | $100,051 | Rates $0.00000772/vCPU-s + $0.00000386/GB-s. citeturn16open0 |
|  | Per-agent container | $2,001 (200 × $10) | $100,050 | $1,000,500 | Same rate applied per agent. |
| **Fly.io** | Mega-service (2 GB shared-cpu-1x nodes) | $53.50 (5 nodes × $10.70) | $2,675 (250 nodes) | $26,750 (2,500 nodes) | Shared-cpu pricing. citeturn4open0 |
|  | Per-agent (512 MB shared-cpu-1x) | $638 (200 × $3.19) | $31,900 | $319,000 | |
| **AWS ECS (Fargate)** | Mega-service (resource pricing) | $178 (5 vCPU/10 GB) | $8,887 | $88,867 | CPU $0.000011244/vCPU-s, RAM $0.000001235/GB-s. citeturn5open0 |
|  | Per-agent task | $1,777 (per agent ≈ $8.89) | $88,867 | $888,672 | Same rate applied per task. |
| **AWS EC2 (t3.small instances)** | Mega-service | $75.90 (5 × $15.18) | $3,795 | $37,950 | t3.small price. citeturn8open0 |
|  | Per-agent (t3.nano) | $760 (200 × $3.80) | $38,000 | $380,000 | t3.nano price. citeturn8open0 |
| **Render** | Mega-service (Standard 2 GB) | $125 (5 × $25) | $6,250 | $62,500 | Pricing tiers. citeturn10open0 |
|  | Per-agent (Starter 512 MB) | $1,400 (200 × $7) | $70,000 | $700,000 | |
| **Heroku** | Mega-service (Standard-1X dynos) | $500 (20 × $25) | $25,000 | $250,000 | Dyno pricing. citeturn12open0 |
|  | Per-agent (Basic dyno) | $1,400 (200 × $7) | $70,000 | $700,000 | |
| **Cloudflare Workers for Platforms** | Per-request (50k req/agent) | $25 (covered by 20 M included requests) | $218 (extra 480 M req + CPU ms) | $2,018 (extra 4.98 B req + CPU ms) | Pricing & included quotas. citeturn13open0 |

### 3.3 Per-Agent Infrastructure Cost & Suggested Pass-Through

| Provider | Infra Cost / Agent / Month | Suggested Customer Price* | Rationale |
| --- | --- | --- | --- |
| Railway | ~$10 (0.25 vCPU + 0.5 GB always-on). citeturn16open0 | $15–$20 | Covers infra + platform support margin. |
| Fly.io | $3.19 (512 MB shared-cpu-1x). citeturn4open0 | $10–$12 | Add bandwidth + support overhead. |
| AWS ECS (Fargate) | ~$8.89 (continuous). citeturn5open0 | $15 | Aligns with enterprise expectations + AWS networking. |
| AWS EC2 (t3.nano) | ~$3.80. citeturn8open0 | $10 | Account for AMI maintenance + Elastic IPs. |
| Render | $7 (Starter). citeturn10open0 | $15 | PaaS premium + support. |
| Heroku | $7 (Basic dyno). citeturn12open0 | $18 | Heroku network egress + paid support. |
| Cloudflare Workers | ~$0.02 (with 50k req/agent) due to pay-per-use model. citeturn13open0 | $5+ | Charge for bundled analytics + storage even if infra cost is tiny. |

\*Suggested price = infra cost × ~1.5–3× to fund support, observability, and LLM usage buffers.

### 3.4 Railway vs SSE Migration Plan

The WebSocket-to-SSE migration plan (`../core-migration/websocket-to-sse-migration-2.md`) models Railway costs at **$513/mo (WebSocket)** vs **$9/mo (SSE)** for 100 users because SSE allows scale-to-zero: Railway only bills while containers are actively handling HTTP requests. Our tables above assume “always-on” containers for apples-to-apples comparisons; once the SSE migration is complete and the runtime is request/response based, Railway’s effective cost drops to the SSE plan’s numbers because idle containers sleep. That makes Railway + SSE the cheapest option by far for free/pro tiers, while AWS/Fly remain better fits for high-value tenants who need constant uptime.

## 4. Architecture Trade-offs

1. **Mega-Service vs Per-Agent Containers**  
   - Mega-service keeps infra simple but demands robust multi-tenant isolation (RLS, buffer limits, throttling). Fits Fly, Railway (post-SSE), and ECS with horizontal autoscaling.  
   - Per-agent containers make isolation trivial yet explode cost (linear in agent count). Only Cloudflare Workers (pay-per-use) or Fly Machines with aggressive auto-stop avoid runaway bills.

2. **Provider Alignment with SSE Plan**  
   - SSE unlocks Railway’s scale-to-zero billing, matching the 57–153× savings cited in the migration plan.  
   - Cloudflare Workers already behave like SSE (request-scoped, no persistent sockets), so costs resemble the “after” scenario today.  
   - AWS ECS/Fargate also benefit from SSE: you can terminate idle tasks without dropping connections, but WebSockets require warm tasks, raising baseline cost.

3. **Monitoring & Tooling**  
   - Railway/Fly provide app-level dashboards but still require Honeycomb/Grafana for tenant-level observability.  
   - AWS (ECS/EC2) integrates with CloudWatch/Container Insights, which aligns with the platform plan’s Section 7 requirements.  
   - Cloudflare Workers offers per-tenant analytics automatically; however, debugging long-lived flows (e.g., MCP stdio) is harder because you lack container shells.

## 5. Recommendations

1. **Ship the hardening backlog before choosing a host.** Missing modules (MessageStreamManager, storage wrapper, throttling, gateway client) are required regardless of platform.
2. **Use Railway + WebSockets for MVP, but budget using the “always-on” numbers above so there are no surprises.** Once the SSE migration lands, you can immediately realize the SSE plan’s 57–153× savings.
3. **Pilot Fly.io and AWS ECS in parallel.**  
   - Fly for cost-effective shared runtimes with optional auto-stop.  
   - ECS for enterprise tenants who need per-tenant isolation, VPC peering, or private networking.
4. **Offer per-agent pricing tiers based on the table in §3.3.** For example, “Dedicated Fly agent = $12/mo”, “Dedicated ECS agent = $25/mo”, “Cloudflare serverless agent = $5/mo”. This keeps customer pricing grounded in real infrastructure costs plus a predictable margin.
5. **Document when to prefer Cloudflare Workers.** They’re ideal for users demanding one-agent-per-customer isolation with built-in analytics, but the absence of arbitrary containers limits MCP stdio and filesystem access.
6. **Revisit hosting choices after SSE rollout.** If Railway truly hits $9/mo for 100 users post-SSE (per the migration plan), we can keep free/pro users there and reserve premium providers for enterprise deals.
