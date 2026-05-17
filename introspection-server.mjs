import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "http";
import { z } from "zod";

const server = new McpServer({
  name: "amber",
  version: "1.1.0",
});

// Memory tools (9)

server.tool(
  "amber_store_memory",
  "Store text as long-term memory. Returns a task_id for tracking. The text is processed in background: chunked into atomic facts, each fact expanded and embedded in parallel, topics resolved, then memories inserted. Typically completes in 10-30 seconds.",
  {
    content: z.string().min(1).max(50000).describe("The text to remember, 1-50000 characters."),
    metadata: z.record(z.any()).optional().describe("Concrete values for exact-match filtering in searches. Example: {person: \"Sarah\", date: \"2026-05-09\"}."),
    topics: z.array(z.string()).optional().describe("Optional broad categories for this memory (e.g. 'work', 'health', 'travel'). Matched semantically."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_get_store_task_status",
  "Check the processing status of a memory store task. Statuses: pending, processing, completed, error.",
  {
    task_id: z.string().min(1).describe("The task_id returned by amber_store_memory."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_search_memories",
  "Find active memories by semantic meaning. Write the query as a natural-language question, NOT keywords. Supports optional metadata filtering and topic filtering. Results ordered by relevance.",
  {
    query: z.string().min(1).describe("Natural-language question or description of what to find."),
    n_results: z.number().int().min(1).max(100).optional().describe("Maximum number of results (default 10, max 100)."),
    metadata_filter: z.record(z.any()).optional().describe("Optional metadata filter for exact-match filtering."),
    topics: z.array(z.string()).optional().describe("Optional topic filter. Matched semantically."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_get_memory",
  "Retrieve a single memory by its ID.",
  {
    memory_id: z.string().min(1).describe("The memory ID."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_delete_memory",
  "Soft-delete one or more memories: moves them to the trash. Pass memory_id for single or memory_ids for batch (max 100).",
  {
    memory_id: z.string().min(1).optional().describe("The memory ID to move to trash (single)."),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe("Array of memory IDs to move to trash (batch, max 100)."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_restore_memory",
  "Restore one or more previously soft-deleted memories back from the trash. Pass memory_id for single or memory_ids for batch (max 100).",
  {
    memory_id: z.string().min(1).optional().describe("The memory ID to restore (single)."),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe("Array of memory IDs to restore (batch, max 100)."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_search_deleted_memories",
  "Search within the trash for soft-deleted memories. Results ordered by relevance. Use amber_restore_memory to bring a result back.",
  {
    query: z.string().min(1).describe("Natural-language question or description of what to find."),
    n_results: z.number().int().min(1).max(100).optional().describe("Maximum results (default 10, max 100)."),
    metadata_filter: z.record(z.any()).optional().describe("Optional metadata filter."),
    max_age_days: z.number().int().positive().optional().describe("Only consider memories deleted within the last N days."),
    topics: z.array(z.string()).optional().describe("Optional topic filter. Matched semantically."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_list_memories",
  "Browse all active memories in reverse chronological order. Use cursor-based pagination via after_id.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20, max 100)."),
    after_id: z.string().optional().describe("Cursor from the next_cursor field of a previous page."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_list_deleted_memories",
  "Browse the trash in reverse chronological order of deletion. Supports cursor pagination.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20, max 100)."),
    after_id: z.string().optional().describe("Cursor from the next_cursor field of a previous page."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

// Account tools (7)

server.tool(
  "amber_get_account_status",
  "Return the authenticated user's account summary: subscription state, next billing date, memory counts, and account creation date.",
  {},
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_manage_subscription",
  "Return a PayPal URL the user can open to manage their subscription.",
  {},
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_cancel_subscription",
  "Cancel the authenticated user's PayPal subscription. Access continues until the current billing period ends. Requires confirm: true.",
  {
    confirm: z.boolean().describe("Must be true to confirm subscription cancellation."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_reactivate_subscription",
  "Create a new PayPal subscription. Returns an approval URL for the user to open in their browser. First-time subscribers get a 60-day free trial.",
  {},
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_export_memories",
  "Export every active memory as a JSON file. Returns a download URL valid for 7 days.",
  {},
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_delete_account",
  "Schedule the authenticated user's account for permanent deletion in 30 days. Requires confirm: true.",
  {
    confirm: z.boolean().describe("Must be true to confirm account deletion scheduling."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_cancel_account_deletion",
  "Cancel a previously scheduled account deletion. Access resumes until next_billing_date.",
  {},
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

// Feedback tools (2)

server.tool(
  "amber_send_feedback_to_developer",
  "Send a bug report, feature request, or general feedback to the developer. Send proactively when encountering errors.",
  {
    category: z.enum(["bug", "feature_request", "usability", "general"]).describe("Type of feedback."),
    summary: z.string().min(1).describe("One-line summary of the feedback."),
    details: z.string().min(1).describe("Full context: what was tried, what happened, error messages, suggestions."),
    tool_context: z.string().optional().describe("The tool being used when the issue occurred, if relevant."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

server.tool(
  "amber_mark_notification_read",
  "Mark a developer notification as read after the user has acknowledged it.",
  {
    notification_id: z.number().int().describe("The ID from the developer_notifications payload."),
  },
  async () => ({ content: [{ type: "text", text: "Introspection-only server" }] }),
);

// Start server
const PORT = parseInt(process.env.PORT || "3000");
const httpServer = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } else if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
  } else {
    res.writeHead(404).end();
  }
});

httpServer.listen(PORT, () => {
  console.log(`Amber introspection server listening on port ${PORT}`);
});
