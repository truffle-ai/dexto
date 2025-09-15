# 🚀 OpenRouter Integration - Complete Setup Guide

This guide shows how the OpenRouter integration works in the shipped CLI package.

## 🎯 **What Users Get**

After installing Dexto CLI, users can:

1. **Login once** → Automatically get OpenRouter API key
2. **Use any OpenRouter model** → No manual API key setup
3. **Seamless experience** → Just like using any other provider

## 📦 **Shipped Configuration**

The CLI package includes:

- ✅ **Built-in API URL**: `https://openrouter-keys-a4revhke9-shaunaks-projects-e4d9aa30.vercel.app`
- ✅ **Automatic provisioning**: OpenRouter keys created during login
- ✅ **Example configurations**: Ready-to-use agent configs
- ✅ **CLI commands**: Status, regenerate, models commands

## 🔄 **Complete User Flow**

### 1. **Install CLI**
```bash
npm install -g dexto
```

### 2. **Login (Auto-provisions OpenRouter key)**
```bash
dexto login
```
**Output:**
```
🌐 Opening browser for authentication...
✅ Login successful!
Welcome back, user@example.com
🔑 Provisioning OpenRouter API key...
✅ OpenRouter API key provisioned successfully!
   Key ID: key_123
   You can now use all OpenRouter models without manual setup
```

### 3. **Use OpenRouter Models**
Create an agent config:

```yaml
# my-agent.yml
llm:
  provider: openai-compatible
  router: vercel
  baseURL: https://openrouter.ai/api/v1
  model: openai/gpt-4o
  # No apiKey needed - automatically uses provisioned key
```

### 4. **Run Agent**
```bash
dexto my-agent.yml "Hello, world!"
```

## 🛠 **Available CLI Commands**

### **Check OpenRouter Status**
```bash
dexto openrouter-status
```
**Output:**
```
✅ OpenRouter API key is configured
   Key: sk-or-v1-abc123...
   You can use all OpenRouter models without manual setup
```

### **See Available Models**
```bash
dexto openrouter-models
```
**Output:**
```
✅ OpenRouter API key found

Popular OpenRouter models you can use:
   1. openai/gpt-4o
   2. openai/gpt-4o-mini
   3. anthropic/claude-3-5-sonnet-20241022
   4. anthropic/claude-3-5-haiku-20241022
   5. google/gemini-2.0-flash-exp
   ...

To use these models, configure your agent with:
   provider: openai-compatible
   router: vercel
   baseURL: https://openrouter.ai/api/v1
   model: <model-name>
```

### **Regenerate API Key**
```bash
dexto openrouter-regenerate
```

## 📋 **Example Agent Configurations**

### **GPT-4o via OpenRouter**
```yaml
llm:
  provider: openai-compatible
  router: vercel
  baseURL: https://openrouter.ai/api/v1
  model: openai/gpt-4o
  temperature: 0.7
  maxOutputTokens: 2000
```

### **Claude 3.5 Sonnet via OpenRouter**
```yaml
llm:
  provider: openai-compatible
  router: vercel
  baseURL: https://openrouter.ai/api/v1
  model: anthropic/claude-3-5-sonnet-20241022
  temperature: 0.5
  maxOutputTokens: 4000
```

### **Gemini 2.0 Flash via OpenRouter**
```yaml
llm:
  provider: openai-compatible
  router: vercel
  baseURL: https://openrouter.ai/api/v1
  model: google/gemini-2.0-flash-exp
  temperature: 0.8
  maxOutputTokens: 1000
```

## 🔧 **Technical Details**

### **Automatic Setup Process**
1. User runs `dexto login`
2. CLI opens browser for OAuth authentication
3. User authenticates with Google/GitHub
4. CLI receives Supabase JWT token
5. CLI calls Vercel API with JWT token
6. Vercel API verifies token and provisions OpenRouter key
7. CLI stores OpenRouter key in `~/.dexto/auth.json`
8. Key is automatically used for all OpenRouter requests

### **Security**
- ✅ **Provisioning key** never exposed to clients
- ✅ **User keys** stored locally only
- ✅ **JWT verification** on server-side
- ✅ **One key per user** with $10 default limit
- ✅ **Key reuse** to prevent spam

### **File Locations**
- **Auth config**: `~/.dexto/auth.json`
- **API endpoint**: `https://openrouter-keys-a4revhke9-shaunaks-projects-e4d9aa30.vercel.app`
- **Example configs**: `agents/openrouter-example.yml`

## 🎉 **Ready to Ship!**

The CLI package is now ready for distribution with:

- ✅ **Zero-config OpenRouter access**
- ✅ **Automatic API key provisioning**
- ✅ **Complete example configurations**
- ✅ **User-friendly CLI commands**
- ✅ **Secure server-side key management**

Users can install and immediately start using any OpenRouter model without any manual setup!
