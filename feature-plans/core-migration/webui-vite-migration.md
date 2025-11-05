# WebUI Migration: Next.js to Vite

## Executive Summary

Migrate Dexto's WebUI from Next.js 15 standalone to Vite + React SPA to align with Mastra's simpler architecture, reduce resource footprint, and enable single-process deployment.

**Current:** Two-process architecture (Next.js server + Hono API server)
**Target:** Single-process architecture (Hono serves both API and static SPA)

**Timeline:** 1-2 weeks
**Difficulty:** 5/10 (Moderate - mostly mechanical changes)
**Risk:** Low (well-understood migration path)

---

## Current Architecture

### Two-Process Model

```
┌─────────────────────────────────────────────────┐
│ dexto start --web                               │
└────────────┬────────────────────────────────────┘
             │
             ├─────► Process 1: Next.js Server
             │       Port: 3000
             │       Memory: ~80-100MB
             │       Startup: ~2-3 seconds
             │       Entry: packages/cli/dist/webui/server.js
             │       Purpose: Serve WebUI
             │
             └─────► Process 2: Hono API Server
                     Port: 3001
                     Memory: ~40-50MB
                     Startup: ~500ms
                     Entry: @dexto/server
                     Purpose: REST API + WebSocket
```

### Build Process

```bash
# WebUI build
cd packages/webui
BUILD_STANDALONE=true next build
# Output: .next/standalone/ (Next.js server + dependencies)

# Copy to CLI
cp -r .next/standalone/ ../cli/dist/webui/
cp -r .next/static/ ../cli/dist/webui/.next/static/
cp -r public/ ../cli/dist/webui/public/

# Runtime
node packages/cli/dist/webui/server.js  # Spawned by CLI
```

### Current Issues

1. **Process management complexity** - Two processes to coordinate
2. **Higher resource usage** - Full Next.js runtime overhead
3. **Slower startup** - Next.js server initialization delay
4. **Port coordination** - Must manage two ports (3000, 3001)
5. **Build complexity** - Next.js standalone bundling quirks
6. **CORS required** - Cross-origin requests between ports

---

## Target Architecture

### Single-Process Model (Mastra Pattern)

```
┌─────────────────────────────────────────────────┐
│ dexto start --web                               │
└────────────┬────────────────────────────────────┘
             │
             └─────► Process: Hono Server
                     Port: 3001 (configurable)
                     Memory: ~40-50MB
                     Startup: ~500ms

                     Routes:
                     /api/*        → REST API
                     /             → WebSocket
                     /*            → Static SPA files
```

### Build Process

```bash
# WebUI build
cd packages/webui
vite build
# Output: dist/ (static HTML/JS/CSS)

# Copy to CLI
cp -r dist/ ../cli/dist/webui/

# Runtime
# Hono server serves static files from dist/webui/
# No separate process needed
```

### Benefits

1. ✅ **Simpler deployment** - Single process, single port
2. ✅ **Lower memory** - ~40-50MB total (vs ~130MB)
3. ✅ **Faster startup** - ~500ms (vs ~3 seconds)
4. ✅ **No CORS needed** - Same origin for API and UI
5. ✅ **Lighter build** - Static files vs standalone server
6. ✅ **Aligns with Mastra** - Same architectural pattern

---

## Migration Phases

### Phase 1: Vite Setup and Configuration (2-3 days)

**Goal:** Configure Vite build system with all required plugins

**Tasks:**

- [ ] Create `packages/webui/vite.config.ts`
- [ ] Install Vite and required plugins
  - `vite`
  - `@vitejs/plugin-react` (for React Fast Refresh)
  - `vite-tsconfig-paths` (for path aliases)
- [ ] Configure build output directory
- [ ] Set up Tailwind CSS with Vite
- [ ] Configure path aliases (`@/` → `./src/`)
- [ ] Set up environment variable handling
- [ ] Configure proxy for development mode

**Deliverables:**
- Working Vite config
- Dev server starts successfully
- Tailwind CSS compiles correctly

**Technical details:**

```typescript
// packages/webui/vite.config.ts
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    plugins: [react()],

    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },

    // Build configuration
    build: {
      outDir: 'dist',
      sourcemap: true,
      // Optimize chunk size
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'radix-vendor': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-select',
              // ... other radix components
            ],
          },
        },
      },
    },

    // Development server with API proxy
    server: isDev ? {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
        '/ws': {
          target: 'ws://localhost:3001',
          ws: true,
        },
      },
    } : undefined,

    // Environment variable prefix
    envPrefix: 'VITE_',
  };
});
```

**Update package.json:**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    // Remove Next.js
    // "next": "15.5.2",

    // Add Vite
    "vite": "^6.3.0",
    "@vitejs/plugin-react": "^4.3.0",

    // Add React Router
    "react-router-dom": "^7.6.0"
  }
}
```

---

### Phase 2: Routing Migration (3-4 days)

**Goal:** Convert Next.js App Router to React Router

**Current Next.js structure:**
```
packages/webui/src/app/
├── layout.tsx           # Root layout
├── page.tsx             # Home page
├── agents/
│   └── page.tsx         # Agents page
├── settings/
│   └── page.tsx         # Settings page
└── api/                 # API routes (move to Hono)
```

**Target Vite structure:**
```
packages/webui/src/
├── main.tsx             # Entry point
├── App.tsx              # Root component with router
├── routes/
│   ├── Root.tsx         # Root layout
│   ├── Home.tsx         # Home page
│   ├── Agents.tsx       # Agents page
│   └── Settings.tsx     # Settings page
└── components/          # Existing components
```

**Tasks:**

- [ ] Create `src/main.tsx` entry point
- [ ] Create `src/App.tsx` with router setup
- [ ] Convert `app/layout.tsx` → `routes/Root.tsx`
- [ ] Convert `app/page.tsx` → `routes/Home.tsx`
- [ ] Convert all nested pages to route components
- [ ] Replace Next.js navigation components
  - `next/link` → `react-router-dom Link`
  - `useRouter()` → `useNavigate()`
  - `usePathname()` → `useLocation()`
  - `useSearchParams()` → `useSearchParams()`
- [ ] Update all imports
- [ ] Remove Next.js-specific code

**Deliverables:**
- All routes working with React Router
- Navigation between pages functional
- URL parameters and query strings working

**Code examples:**

```typescript
// src/main.tsx (new entry point)
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

```typescript
// src/App.tsx (router configuration)
import { Routes, Route } from 'react-router-dom';
import { Root } from './routes/Root';
import { Home } from './routes/Home';
import { Agents } from './routes/Agents';
import { Settings } from './routes/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />}>
        <Route index element={<Home />} />
        <Route path="agents" element={<Agents />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
```

```typescript
// src/routes/Root.tsx (converted from app/layout.tsx)
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme-provider';

export function Root() {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>
          <Outlet /> {/* Renders child routes */}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Migration checklist for each page:**

```typescript
// BEFORE (Next.js)
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

export default function AgentsPage() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div>
      <Link href="/settings">Settings</Link>
      <button onClick={() => router.push('/home')}>Home</button>
      <p>Current path: {pathname}</p>
    </div>
  );
}

// AFTER (Vite + React Router)
import { Link, useNavigate, useLocation } from 'react-router-dom';

export function Agents() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div>
      <Link to="/settings">Settings</Link>
      <button onClick={() => navigate('/home')}>Home</button>
      <p>Current path: {location.pathname}</p>
    </div>
  );
}
```

---

### Phase 3: Component Updates (2-3 days)

**Goal:** Replace Next.js-specific components and APIs

**Tasks:**

- [ ] Replace `next/image` with standard `<img>` or optimized alternative
- [ ] Replace `next/head` with `react-helmet-async`
- [ ] Update environment variable access
  - `process.env.NEXT_PUBLIC_*` → `import.meta.env.VITE_*`
- [ ] Replace `next/font` with standard CSS font loading
- [ ] Update API calls to use relative paths (same origin)
- [ ] Remove `'use client'` directives (not needed in Vite)
- [ ] Update dynamic imports if any

**Deliverables:**
- All components free of Next.js dependencies
- Images loading correctly
- Environment variables working
- Fonts loading properly

**Code examples:**

```typescript
// Image handling
// BEFORE (Next.js)
import Image from 'next/image';
<Image src="/logo.png" alt="Logo" width={100} height={100} />

// AFTER (Vite)
<img src="/logo.png" alt="Logo" className="w-25 h-25" />
// Or use a library like react-image for lazy loading
```

```typescript
// Environment variables
// BEFORE (Next.js)
const apiUrl = process.env.NEXT_PUBLIC_API_URL;

// AFTER (Vite)
const apiUrl = import.meta.env.VITE_API_URL;
```

```typescript
// Head/meta tags
// BEFORE (Next.js)
import Head from 'next/head';
<Head>
  <title>Dexto</title>
  <meta name="description" content="..." />
</Head>

// AFTER (Vite with react-helmet-async)
import { Helmet } from 'react-helmet-async';
<Helmet>
  <title>Dexto</title>
  <meta name="description" content="..." />
</Helmet>
```

**Add to App.tsx:**
```typescript
import { HelmetProvider } from 'react-helmet-async';

export default function App() {
  return (
    <HelmetProvider>
      <BrowserRouter>
        <Routes>...</Routes>
      </BrowserRouter>
    </HelmetProvider>
  );
}
```

---

### Phase 4: Hono Server Integration (2-3 days)

**Goal:** Serve static SPA files from Hono server

**Tasks:**

- [ ] Add static file serving to Hono server
- [ ] Configure SPA fallback (all routes → index.html)
- [ ] Update build scripts to copy Vite output to CLI
- [ ] Remove Next.js server spawning code from CLI
- [ ] Update CLI commands to use single-process mode
- [ ] Test WebSocket on same port
- [ ] Update CORS configuration (no longer needed)

**Deliverables:**
- Hono serves both API and UI on single port
- SPA routing works correctly
- WebSocket connections working
- CLI build includes Vite output

**Code changes:**

```typescript
// packages/server/src/hono/index.ts
import { serveStatic } from '@hono/node-server/serve-static';
import path from 'path';

export function createDextoApp(options: CreateDextoAppOptions): DextoApp {
  const app = new OpenAPIHono({ strict: false }) as DextoApp;

  // ... existing middleware and routes ...

  // API routes (no change)
  const apiPrefix = options.apiPrefix ?? '/api';
  app.route(apiPrefix, api);

  // Serve static WebUI files
  // In production, files are at packages/cli/dist/webui/
  const webuiPath = options.webuiPath || path.join(__dirname, '../../webui');

  app.use('/*', serveStatic({
    root: webuiPath,
    // Don't serve index.html yet - let it fall through to catch-all
  }));

  // SPA fallback - serve index.html for all non-API routes
  app.get('/*', (c) => {
    return c.html(fs.readFileSync(path.join(webuiPath, 'index.html'), 'utf-8'));
  });

  return app;
}
```

**Update CLI build script:**

```typescript
// packages/cli/scripts/copy-webui.ts
import fs from 'fs-extra';
import path from 'path';

const webuiDist = path.resolve(__dirname, '../../webui/dist');
const cliWebui = path.resolve(__dirname, '../dist/webui');

// Copy Vite build output to CLI dist
await fs.copy(webuiDist, cliWebui, {
  overwrite: true,
  filter: (src) => !src.includes('node_modules'),
});

console.log('✓ Copied WebUI to CLI dist');
```

**Remove Next.js spawning code:**

```typescript
// packages/cli/src/web.ts
// DELETE ENTIRE FILE - no longer needed

// packages/cli/src/index.ts
// Remove Next.js server spawning
// Hono server now serves everything
```

**Update package.json:**

```json
{
  "scripts": {
    "build:webui": "pnpm --filter @dexto/webui build",
    "build:cli": "pnpm --filter @dexto/cli build",
    "build:all": "pnpm build:webui && node packages/cli/scripts/copy-webui.ts && pnpm build:cli"
  }
}
```

---

### Phase 5: Development Experience (1-2 days)

**Goal:** Ensure smooth development workflow

**Tasks:**

- [ ] Set up Vite dev server with HMR
- [ ] Configure API proxy in Vite config
- [ ] Update development scripts
- [ ] Test hot reload functionality
- [ ] Document new development workflow
- [ ] Create debugging guide

**Deliverables:**
- Fast dev server with HMR
- Seamless API integration in dev mode
- Updated documentation

**Development workflow:**

```bash
# Terminal 1: Start API server
cd packages/cli
pnpm dev  # or dexto start --api

# Terminal 2: Start Vite dev server
cd packages/webui
pnpm dev  # Runs on port 3000, proxies /api to 3001
```

**Vite dev config:**

```typescript
// vite.config.ts
export default defineConfig(({ mode }) => {
  if (mode === 'development') {
    return {
      server: {
        port: 3000,
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
          },
          '/ws': {
            target: 'ws://localhost:3001',
            ws: true,
          },
        },
      },
    };
  }

  // Production config
  return { /* ... */ };
});
```

---

### Phase 6: Testing and Polish (1-2 days)

**Goal:** Ensure everything works correctly

**Tasks:**

- [ ] Test all routes and navigation
- [ ] Test WebSocket connections
- [ ] Test API calls from UI
- [ ] Test production build
- [ ] Test CLI installation and running
- [ ] Performance testing (bundle size, load time)
- [ ] Update all documentation
- [ ] Create migration guide for contributors

**Deliverables:**
- All features working correctly
- Performance metrics documented
- Complete documentation

**Testing checklist:**

- [ ] Home page loads
- [ ] Navigation between pages works
- [ ] API calls succeed
- [ ] WebSocket connects and receives events
- [ ] Agent switching works
- [ ] Settings persist
- [ ] File uploads work
- [ ] Image rendering correct
- [ ] Theming (dark/light mode) works
- [ ] Responsive design intact
- [ ] Build size reasonable (<2MB gzipped)
- [ ] Load time <2 seconds on fast connection

---

## Environment Variable Migration

### Next.js Environment Variables

```bash
# .env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
```

### Vite Environment Variables

```bash
# .env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001/
VITE_FRONTEND_URL=http://localhost:3000
```

**Update all references:**

```typescript
// Find and replace across codebase
process.env.NEXT_PUBLIC_API_URL → import.meta.env.VITE_API_URL
process.env.NEXT_PUBLIC_WS_URL → import.meta.env.VITE_WS_URL
```

**TypeScript env types:**

```typescript
// src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_FRONTEND_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

---

## Bundle Size Comparison

### Current (Next.js)

```
Next.js standalone server:
├── server.js               ~500KB
├── node_modules/           ~30MB
├── .next/static/
│   ├── chunks/
│   │   ├── main.js         ~200KB
│   │   ├── framework.js    ~150KB
│   │   └── pages/*.js      ~800KB
│   └── css/
│       └── *.css           ~50KB
└── Total runtime:          ~80-100MB memory
```

### Target (Vite)

```
Vite static build:
├── index.html              ~5KB
├── assets/
│   ├── index-abc123.js     ~300KB (React + app code)
│   ├── vendor-def456.js    ~200KB (dependencies)
│   └── index-ghi789.css    ~50KB
└── Total: ~600KB gzipped

Runtime: ~40-50MB (just Hono server)
```

**Savings:**
- **Memory**: ~50% reduction (100MB → 50MB)
- **Startup**: ~80% faster (3s → 0.5s)
- **Bundle**: ~50% smaller (1.2MB → 600KB)

---

## Risk Mitigation

### Identified Risks

1. **Risk:** Dynamic imports may break
   - **Mitigation:** Test all code-splitting points, use Vite's dynamic import syntax
   - **Severity:** Low

2. **Risk:** Image optimization loss
   - **Mitigation:** Use modern image formats (WebP), implement lazy loading
   - **Severity:** Low (images not heavily used)

3. **Risk:** SEO impact from SPA
   - **Mitigation:** Not a concern - Dexto is a developer tool, not public-facing
   - **Severity:** None

4. **Risk:** Breaking changes in dependencies
   - **Mitigation:** Pin dependency versions, test thoroughly
   - **Severity:** Low

5. **Risk:** WebSocket connection issues
   - **Mitigation:** Same server, same port - should simplify, not complicate
   - **Severity:** Very Low

### Rollback Plan

If migration encounters critical issues:

1. Keep Next.js code in a git branch
2. Feature flag to toggle between Next.js and Vite builds
3. Can revert quickly by switching build script

```json
{
  "scripts": {
    "build": "npm run build:vite",
    "build:vite": "vite build",
    "build:nextjs": "BUILD_STANDALONE=true next build"
  }
}
```

---

## Success Criteria

### Functional Requirements

- [ ] All existing features work identically
- [ ] Navigation is smooth and fast
- [ ] API calls succeed
- [ ] WebSocket connections stable
- [ ] File uploads work
- [ ] Settings persist
- [ ] Dark/light theme works

### Performance Requirements

- [ ] Bundle size <800KB gzipped
- [ ] Initial load <2 seconds
- [ ] HMR <200ms in development
- [ ] Memory usage <60MB
- [ ] Startup time <1 second

### Developer Experience

- [ ] Dev server starts <1 second
- [ ] Hot reload works instantly
- [ ] Clear error messages
- [ ] Easy to debug

### Documentation

- [ ] Migration guide for contributors
- [ ] Updated development docs
- [ ] Build and deployment guide
- [ ] Troubleshooting guide

---

## Timeline and Dependencies

### Detailed Schedule

| Phase | Days | Dependencies | Blocking |
|-------|------|--------------|----------|
| 1. Vite Setup | 2-3 | None | Phase 2 |
| 2. Routing | 3-4 | Phase 1 | Phase 3 |
| 3. Components | 2-3 | Phase 2 | Phase 4 |
| 4. Server Integration | 2-3 | Phase 3 | Phase 5 |
| 5. Dev Experience | 1-2 | Phase 4 | Phase 6 |
| 6. Testing | 1-2 | Phase 5 | None |

**Total: 11-17 days (1.5-2.5 weeks)**

**Critical path:** Phase 1 → 2 → 3 → 4 (9-13 days)

### Parallel Work Opportunities

Can be done in parallel:
- Documentation updates (ongoing throughout)
- Performance testing (after Phase 4)
- Migration guide writing (during Phase 5-6)

---

## Code Migration Checklist

### Imports to Update

```typescript
// Find and replace these across all files:

// Routing
import { ... } from 'next/navigation'     → import { ... } from 'react-router-dom'
import { ... } from 'next/router'         → import { ... } from 'react-router-dom'
import Link from 'next/link'              → import { Link } from 'react-router-dom'

// Images
import Image from 'next/image'            → <img> or optimized alternative

// Head/Meta
import Head from 'next/head'              → import { Helmet } from 'react-helmet-async'

// Env vars
process.env.NEXT_PUBLIC_*                 → import.meta.env.VITE_*
```

### Files to Delete

```
packages/webui/
├── next.config.ts                 ❌ DELETE
├── next-env.d.ts                  ❌ DELETE
├── .next/                         ❌ DELETE (build output)
└── src/
    └── app/                       ❌ MIGRATE to routes/
        └── api/                   ❌ MOVE to Hono server

packages/cli/
└── src/
    └── web.ts                     ❌ DELETE (Next.js spawning)
```

### Files to Create

```
packages/webui/
├── vite.config.ts                 ✅ CREATE
├── index.html                     ✅ CREATE
├── src/
│   ├── main.tsx                   ✅ CREATE (entry point)
│   ├── App.tsx                    ✅ CREATE (router)
│   ├── routes/                    ✅ CREATE
│   │   ├── Root.tsx
│   │   ├── Home.tsx
│   │   └── ...
│   └── vite-env.d.ts              ✅ CREATE

packages/cli/
└── scripts/
    └── copy-webui.ts              ✅ CREATE
```

---

## Post-Migration Benefits

### Immediate Benefits

1. **Single command to start** - No more coordinating two servers
2. **Faster development** - HMR is instant with Vite
3. **Simpler deployment** - One process, one port
4. **Lower resource usage** - Half the memory

### Long-term Benefits

1. **Alignment with Mastra** - Easier to adopt their patterns
2. **Easier maintenance** - Less complexity to manage
3. **Better performance** - Lighter bundle, faster loads
4. **Flexible deployment** - Can easily add platform deployers later

### Metrics to Track

**Before migration:**
- Startup time: ~3 seconds
- Memory usage: ~130MB
- Bundle size: ~1.2MB
- Dev HMR: ~1-2 seconds

**After migration:**
- Startup time: ~0.5 seconds (6x faster)
- Memory usage: ~50MB (60% reduction)
- Bundle size: ~600KB (50% smaller)
- Dev HMR: ~200ms (5-10x faster)

---

## Related Work

### Dependencies

- **Independent of project-based architecture** - Can be done before, after, or in parallel
- **Complements server refactoring** - Already using Hono, just adding static serving

### Future Considerations

Once Vite migration is complete, these become easier:

1. **Playground embedding in `dexto dev`** - Static files are easy to serve
2. **Platform deployers** - Can follow Mastra's pattern for Vercel, Cloudflare, etc.
3. **Docker optimization** - Smaller images without Next.js
4. **Edge deployment** - Static files work anywhere

---

## Conclusion

Migrating from Next.js to Vite aligns Dexto with Mastra's simpler, more efficient architecture while providing immediate benefits in performance, resource usage, and developer experience.

**Why this makes sense:**
- Dexto's WebUI doesn't use Next.js SSR features
- Two-process architecture adds unnecessary complexity
- Vite provides better DX and performance for SPAs
- Aligns with industry trend toward lighter tooling

**Key advantages:**
- Single-process deployment
- 60% reduction in memory usage
- 6x faster startup
- Simpler codebase

**Risk level:** Low - Well-understood migration with clear rollback path

**Recommendation:** Proceed with migration. Can be done in parallel with project-based architecture work or as a follow-up.
