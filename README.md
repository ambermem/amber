# Amber

**Long-term memory for AI assistants.**

Amber is an MCP server that gives any AI assistant persistent, searchable memory across conversations. Your AI remembers preferences, decisions, project context, and personal details - without you doing anything special.

> Just talk normally. Amber stores what matters and finds it when relevant.

## Quick Install

One command. Works with any MCP-compatible client.

### Claude Code / Claude Desktop

```bash
claude mcp add --transport http --scope user amber https://mcp.ambermem.com
```

### Cursor

Add to `~/.cursor/mcp.json` (or `%USERPROFILE%\.cursor\mcp.json` on Windows):

```json
{
  "mcpServers": {
    "amber": {
      "url": "https://mcp.ambermem.com"
    }
  }
}
```

### ChatGPT

Settings → Connectors → Create → URL: `https://mcp.ambermem.com`

### Windsurf

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "amber": {
      "serverUrl": "https://mcp.ambermem.com"
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "amber": {
      "type": "http",
      "url": "https://mcp.ambermem.com"
    }
  }
}
```

### Any MCP client

URL: `https://mcp.ambermem.com` | Transport: Streamable HTTP | Auth: OAuth 2.1 (auto-discovered)

## How It Works

1. **You talk to your AI normally.** Amber stores important facts in the background.
2. **Next conversation,** your AI searches Amber automatically when context would help.
3. **Memory improves over time.** The more you use it, the better it gets.

No configuration. No tagging. No manual organization.

## What Makes Amber Different

| Feature | Basic memory servers | Amber |
|---------|---------------------|-------|
| Storage | One embedding per memory | **Multiple semantic variants** per fact |
| Search | Single vector lookup | **Hybrid: vector + keyword + RRF fusion** |
| Queries | Exact match only | **Many phrasings per fact**, matched semantically |
| Input | Stored as-is | **Chunked into atomic facts**, each independently searchable |
| Topics | Manual tags or none | **Auto-grouped**, matched semantically at search time |
| Privacy | Varies by server | **No generative model reads your memories** |
| Time | No temporal awareness | **Natural language time parsing** ("last week", "3 days ago") |

## Technical Details

- **25 MCP tools** (14 memory, 9 account, 2 feedback/notification)
- **Hybrid retrieval pipeline**: vector search + full-text search + Reciprocal Rank Fusion
- **Multi-variant embeddings**: every fact is stored with several paraphrases — at least 5, and a store is rejected below that — which is the main thing that makes it findable later
- **No generative model reads your memories**: your assistant does the chunking, the topics and the phrasings. Memory text is sent only to an *embedding* endpoint (a vector model, not a chat model), so no chat model is ever shown what you store
- **Atomic facts**: a conversation becomes individually searchable facts rather than one blob, each with its own subjects, topics and dates
- **Temporal search**: "what did I say last week?" resolves to a real date range rather than a keyword match
- **Automatic topic grouping**: memories are grouped by topic, and a search for "work" also finds "career" and "job"
- **Async processing**: storage completes in the background, never blocking your conversation

## Pricing

- **60-day free trial** - no charge, cancel anytime
- **$2.99/month** after trial, via PayPal
- **Cancel instantly** - ask your AI to cancel, or cancel through PayPal directly
- **No lock-in** - export all your data as JSON anytime

## Privacy

- No email collected
- No marketing, no spam
- Data isolated per user (separate database)
- PayPal handles all payment info
- Full export + account deletion available
- GDPR compliant (data minimization by design)

## Architecture

Amber runs on Cloudflare Workers (zero cold starts, global edge deployment) with Turso databases (one per user, full isolation). LLM processing uses Gemini Flash for chunking/expansion and OpenAI for embeddings.

For full technical documentation: [ambermem.com/llms.txt](https://ambermem.com/llms.txt)

## Links

- **Website**: [ambermem.com](https://ambermem.com)
- **MCP endpoint**: `https://mcp.ambermem.com`
- **Privacy policy**: [ambermem.com/privacy](https://ambermem.com/privacy)
- **Terms of service**: [ambermem.com/terms](https://ambermem.com/terms)
- **Technical docs (for AI)**: [ambermem.com/llms.txt](https://ambermem.com/llms.txt)
- **Report a problem**: [ambermem.com/report](https://ambermem.com/report) — no account needed, and it works even when your client cannot connect. In-session, an assistant can also call the `amber_send_feedback_to_developer` tool directly.

## FAQ

**Will it slow my AI down?**
No. Storage is async (background). Search adds <1 second.

**What if Amber shuts down?**
Export all your data as JSON anytime. Your data is always yours.

**Do I need a PayPal account?**
Currently yes. PayPal handles both identity and billing. More login options coming soon.

**Is my data safe?**
Each user gets a completely isolated database. No data is shared between users. Amber has no access to your PayPal payment details.

**Can I self-host?**
Not currently. Amber is a managed service. We handle the infrastructure, scaling, and LLM costs so you don't have to.
