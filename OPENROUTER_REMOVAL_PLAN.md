# OpenRouter Removal & Dexto Rebranding Plan

## 🎯 Goal
Remove all user-facing OpenRouter references and replace with Dexto branding. OpenRouter should be completely hidden as internal infrastructure.

---

## 📍 First-Time User Flow Analysis

When a user runs `dexto` for the first time:

### 1. **Entry Point** (`packages/cli/src/index.ts`)
```
User runs: dexto
  ↓
Line 790: Checks `requiresSetup()`
  ↓
Line 801: Runs `handleSetupCommand({ interactive: true })`
```

### 2. **Setup Command** (`packages/cli/src/cli/commands/setup.ts`)
```
Lines 129-174: ❌ PROBLEM - Auto-setup OpenRouter for logged-in users
  - Checks if user is authenticated
  - Automatically configures OpenRouter
  - Sets provider to 'openrouter' in preferences
  - Shows: "Setting up OpenRouter with your existing credentials"

Line 140-145: Creates preferences with provider='openrouter'
Line 150: Shows: "✨ Setup complete! Dexto is configured with OpenRouter."
Line 152: Shows: "💡 You can now use any OpenRouter model"
```

### 3. **Welcome Flow** (`packages/cli/src/cli/utils/welcome-flow.ts`)
```
Line 25-26: ❌ PROBLEM - "Login with Dexto (Recommended)"
  Hint: "Get instant access to 100+ models with automatic setup"

Lines 54-60: ❌ PROBLEM - showLoginDetails() function
  • "Automatic OpenRouter API key provisioning" <- EXPOSES OPENROUTER
  • "Access to 100+ AI models"
  • "Free tier included with $10 credit"
```

### 4. **After Setup** (`packages/cli/src/index.ts`)
```
Lines 828-839: ❌ PROBLEM - Automatic OpenRouter setup
  Runs: setupOpenRouterIfAvailable()
  Shows: "OpenRouter API key configured automatically"
```

---

## 🔍 All Files That Need Changes

### **1. CLI Commands**

#### `packages/cli/src/index.ts`
**Lines to Remove:**
- Lines 520-535: `openrouter-status` command
- Lines 537-552: `openrouter-models` command
- Lines 828-839: Automatic OpenRouter setup block

**Lines to Rebrand:**
- Line 539: Change `openrouter-models` → `models` command (calls `/v1/models` instead)

#### `packages/cli/src/cli/commands/setup.ts`
**Lines to Change:**
- Lines 129-174: Remove OpenRouter auto-setup for logged-in users
- Line 19: Remove `import { setupOpenRouterIfAvailable }`
- Lines 132, 150-152: Remove OpenRouter messaging
- Line 140-145: Change provider from 'openrouter' to 'dexto'

### **2. Welcome & User-Facing Messages**

#### `packages/cli/src/cli/utils/welcome-flow.ts`
**Lines to Change:**
- Line 55: "• Automatic OpenRouter API key provisioning" → "• Automatic AI model access provisioning"
- Lines 54-60: Remove all OpenRouter mentions

#### `packages/cli/src/cli/utils/setup-utils.ts`
**Lines to Change:**
- Line 60: "Choose your AI provider (Google Gemini, OpenAI, etc.)" - ALREADY GOOD (no OpenRouter mention)

#### `packages/cli/src/cli/utils/login-flow.ts`
**Needs Review** - Likely has OpenRouter mentions based on grep results:
- "Configuring OpenRouter access..."
- "🎉 You're all set! Dexto is configured with OpenRouter."

### **3. Internal Helper Files** (Keep but hide from users)

#### `packages/cli/src/cli/utils/openrouter-setup.ts`
**Keep file** but ensure it's only used internally:
- Line 14: `setupOpenRouterIfAvailable()` - KEEP (internal use only)
- Line 30: `getOpenRouterLLMConfig()` - KEEP (internal use only)
- Line 36: `isOpenRouterAvailable()` - KEEP (internal use only)

#### `packages/cli/src/cli/utils/dexto-api-client.ts`
**Keep file** - Has legacy OpenRouter provisioning endpoint (deprecated)

#### `packages/cli/src/cli/commands/openrouter/index.ts`
**DELETE ENTIRE FOLDER** - User-facing OpenRouter commands

---

## ✅ New Dexto-Branded Commands to Add

### **1. `dexto models`**
Replace `dexto openrouter-models` with:
```bash
dexto models
# Calls: GET /v1/models
# Shows: Available AI models from Dexto gateway
```

### **2. `dexto keys` (new command group)**
```bash
dexto keys list         # List DEXTO_API_KEYs
dexto keys rotate       # Rotate DEXTO_API_KEY
```

### **3. `dexto billing` (new command group)**
```bash
dexto billing status    # Show credits and usage
dexto billing history   # Show detailed usage history
```

### **4. Credit Warnings (automatic)**
After each API call, check `X-Dexto-Credits-Remaining` header:
- Warn if balance < $1 (100 cents)
- Show: "⚠️  Low balance: $0.50 remaining. Top up at https://dexto.ai/billing"

---

## 🔧 Implementation Priority

### **Phase 1: Critical User-Facing Changes** (Do First)
1. ✅ Fix `/api/provision` to use service role (DONE)
2. ❌ Remove `openrouter-status` command
3. ❌ Remove `openrouter-models` command → Add `dexto models`
4. ❌ Update welcome flow messages (remove OpenRouter mentions)
5. ❌ Update setup command to not auto-configure OpenRouter branding
6. ❌ Remove automatic OpenRouter setup in index.ts (lines 828-839)

### **Phase 2: Add New Dexto Commands**
1. ❌ Add `dexto keys list`
2. ❌ Add `dexto keys rotate`
3. ❌ Add `dexto billing status`
4. ❌ Add `dexto billing history`

### **Phase 3: Add Credit Warnings**
1. ❌ Add header reading logic after API calls
2. ❌ Add low balance warning display

### **Phase 4: API Endpoints**
1. ❌ Add `POST /api/keys/rotate`
2. ❌ Add `GET /api/me/usage?detailed=true` (already exists, verify)

---

## 📋 Testing Checklist

After changes, test complete flow:

1. **Fresh Install Flow**
   ```bash
   rm -rf ~/.dexto
   dexto
   # Should see: Welcome flow with NO OpenRouter mentions
   # Should see: "Login with Dexto" option
   # After login: Should NOT see "OpenRouter" anywhere
   ```

2. **Command Tests**
   ```bash
   dexto models               # Should list available models
   dexto keys list            # Should list user's API keys
   dexto billing status       # Should show balance and usage
   ```

3. **Credit Warning Test**
   ```bash
   # Make request with low balance account
   # Should see: "⚠️  Low balance: $X.XX remaining"
   ```

---

## 🎨 Messaging Guidelines

### **Before (OpenRouter Exposed):**
- "Automatic OpenRouter API key provisioning"
- "Setting up OpenRouter with your existing credentials"
- "Dexto is configured with OpenRouter"
- "You can now use any OpenRouter model"
- `dexto openrouter-status`
- `dexto openrouter-models`

### **After (Dexto Branded):**
- "Automatic AI model access provisioning"
- "Setting up Dexto AI gateway"
- "Dexto is ready to use"
- "You can now use 100+ AI models"
- `dexto models`
- `dexto billing status`
- `dexto keys list`

**Key Principle:** Users should think they're talking to "Dexto AI Gateway", not "OpenRouter via Dexto"

---

## 📝 Notes

1. **Keep Internal OpenRouter Code**: The `openrouter-setup.ts` file and internal helpers should remain, but never be exposed to users

2. **Provider Selection**: When users do manual setup, they should see:
   - Google (Gemini)
   - OpenAI (GPT-4, etc.)
   - Anthropic (Claude)
   - Dexto (100+ models) <- NEW OPTION

3. **Default Provider**: After `dexto login`, preferences should set provider to `'dexto'`, not `'openrouter'`

4. **Model Format**:
   - Current: `openrouter/anthropic/claude-3-haiku` or `anthropic/claude-3-haiku`
   - Future: Should work with both formats transparently (OpenRouter format for backward compatibility)
