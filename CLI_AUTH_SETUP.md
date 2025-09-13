# CLI OAuth Authentication Setup

## ✅ **Complete Implementation - Ready to Use!**

**No custom backend or database tables needed!** Uses Supabase Auth directly.

### User Experience:
```bash
$ dexto login
🌐 Opening browser for authentication...
✅ Login successful!
Welcome back, john@example.com
```

---

## 🔧 **Setup Steps**

### 1. **Configure Supabase OAuth Providers**

In your Supabase dashboard → Authentication → Providers:

```
✅ Enable Google OAuth
   - Client ID: your-google-client-id
   - Client Secret: your-google-client-secret
   - Redirect URL: https://your-project.supabase.co/auth/v1/callback

✅ Enable GitHub OAuth  
   - Client ID: your-github-client-id
   - Client Secret: your-github-client-secret
   - Redirect URL: https://your-project.supabase.co/auth/v1/callback
```

### 2. **Add CLI Redirect URLs**

In Supabase → Authentication → URL Configuration:

```
Site URL: https://your-app.com
Redirect URLs: 
  - https://your-app.com/*
  - http://localhost:*    # Allow CLI callbacks
```

### 3. **Environment Variables**

For distribution, bake these into your CLI binary:

```typescript
// Built into CLI
export const DEFAULT_OAUTH_CONFIG = {
    authUrl: 'https://your-project.supabase.co',
    clientId: 'your-supabase-anon-key',
};
```

---

## 🚀 **How It Works**

### **OAuth Flow:**
1. **CLI opens browser** → `https://project.supabase.co/auth/v1/authorize?provider=google&redirect_to=http://localhost:8080`
2. **User logs in via Google** → Supabase handles everything
3. **Supabase redirects to CLI** → `http://localhost:8080#access_token=...`
4. **CLI extracts token** → Stores in `~/.dexto/auth.json`
5. **CLI makes requests** → Using Supabase access token

### **Token Usage:**
```typescript
// All CLI requests use the stored token
const response = await fetch(`${supabaseUrl}/rest/v1/your_table`, {
    headers: {
        'Authorization': `Bearer ${storedToken}`,
        'apikey': supabaseAnonKey,
    },
});
```

---

## 📦 **Distribution**

### **Package.json:**
```json
{
  "name": "dexto",
  "bin": {
    "dexto": "./dist/cli.js"
  },
  "dependencies": {}
}
```

### **Built-in Config:**
```typescript
// Baked into distributed CLI binary
const SUPABASE_URL = "https://your-project.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-key";
```

### **Publishing:**
```bash
npm publish              # npm install -g dexto
brew create formula      # brew install dexto  
curl script             # curl -sSL get.dexto.com | sh
```

**Users get zero-config experience:**
```bash
$ npm install -g dexto
$ dexto login           # Just works!
```

---

## 🔒 **Security**

### **What's Safe to Distribute:**
- ✅ **Supabase URL** (public)
- ✅ **Anon Key** (public, meant for client apps)
- ✅ **OAuth provider configs** (public)

### **What's Protected:**
- 🔒 **Service Role Key** (never in CLI)
- 🔒 **OAuth secrets** (stored in Supabase dashboard)
- 🔒 **User access tokens** (stored locally only)

### **Row Level Security:**
```sql
-- Users only see their own data
ALTER TABLE your_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own data" ON your_table
  FOR ALL USING (auth.uid() = user_id);
```

**CLI automatically respects RLS!** 🔒

---

## 🎯 **End Result**

Your CLI works exactly like modern CLIs:

```bash
# Install anywhere
$ npm install -g dexto

# Login once  
$ dexto login
🌐 Opening browser...
✅ Login successful!

# Use your app
$ dexto projects list
$ dexto deploy my-app
$ dexto logs --tail
```

**Zero configuration. Fully distributable. Perfect UX.**