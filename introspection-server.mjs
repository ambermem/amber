import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "amber-mcp-server",
  version: "1.1.0",
});

const noop = async () => ({ content: [{ type: "text", text: "Introspection-only server" }] });

// Memory tools (9)

server.tool(
  "amber_store_memory",
  "Store text as long-term memory. Returns a `task_id` for tracking. " +
    "Use `amber_get_store_task_status` with the task_id to check progress and get the resulting memory IDs when complete. " +
    "The text is processed in background: chunked into atomic facts, each fact expanded and embedded in parallel, " +
    "topics resolved (parallel search + sequential creation), then memories inserted in parallel. Typically completes in 10-30 seconds.\n\n" +
    "Provide `metadata` when there are specific values worth filtering on later.\n\n" +
    "TOPICS vs METADATA -- different purposes:\n\n" +
    "  `topics` = broad subject areas this memory belongs to (like folders). " +
    "Matched SEMANTICALLY: \"career\" will find an existing \"work\" topic automatically, no need to guess exact names. " +
    "Pick 1-3 areas. Auto-created if no similar topic exists. " +
    "Examples: \"work\", \"health\", \"preferences\", \"family\", \"cooking\", \"finances\".\n\n" +
    "  `metadata` = concrete values for EXACT-MATCH filtering in `amber_search_memories`. " +
    "Only useful for specific, structured data you want to filter on later: person names, dates, project names, sources. " +
    "These are NOT semantic -- `metadata: {person: \"Sarah\"}` only matches searches filtered by `person = \"Sarah\"`, not \"Sara\" or \"S. Johnson\". " +
    "Do NOT put categories, importance levels, or topic names in metadata -- that is what topics are for.\n\n" +
    "Examples:\n" +
    "  amber_store_memory({\n" +
    "    content: \"User prefers dark mode in all apps\",\n" +
    "    topics: [\"preferences\"]\n" +
    "  })\n\n" +
    "  amber_store_memory({\n" +
    "    content: \"Meeting with Sarah on Friday to discuss Q3 budget\",\n" +
    "    metadata: {person: \"Sarah\", date: \"2026-05-09\", project: \"Q3 budget\"},\n" +
    "    topics: [\"work\", \"meetings\"]\n" +
    "  })\n\n" +
    "  amber_store_memory({\n" +
    "    content: \"User is allergic to peanuts\",\n" +
    "    topics: [\"health\"]\n" +
    "  })\n\n" +
    "Rate-limited (drip bucket: 1000 capacity, refills ~1 token per 86 seconds. You can burst up to 1000 stores before hitting the limit).",
  {
    content: z.string().min(1).max(50000).describe("The text to remember, 1-50000 characters."),
    metadata: z.record(z.string(), z.unknown()).optional().describe(
      "Concrete values for exact-match filtering in searches. Only useful for structured data like person names, dates, " +
        "project names, sources. NOT for categories or topic names. Example: {person: \"Sarah\", date: \"2026-05-09\"}.",
    ),
    topics: z.array(z.string()).optional().describe(
      "Optional broad categories for this memory (e.g. 'work', 'health', 'travel'). " +
        "Only needed when the category can't be inferred from the text itself -- most memories don't need this. " +
        "Matched semantically, so you don't need to guess exact names. " +
        "Do NOT use topics for specific names, dates, or values -- use `metadata` for those (e.g. {\"person\": \"Sarah\"}). " +
        "Topics are searched semantically; metadata is filtered by exact match.",
    ),
  },
  noop,
);

server.tool(
  "amber_get_store_task_status",
  "Check the processing status of a memory store task. Call this after `amber_store_memory` to confirm processing completed.\n\n" +
    "Statuses: `pending` (queued), `processing` (in progress), `completed` (done, memory_ids available), `error` (permanently failed).\n\n" +
    "Processing phases (shown in `progress` field): chunking → expanding/embedding chunks (parallel) → resolving topics (parallel search, sequential creation) → inserting memories (parallel). " +
    "If processing fails (e.g. LLM timeout), it retries up to 3 times. No duplicates are created on retry. " +
    "Only after all retries are exhausted does the status become `error` with the failure reason.",
  {
    task_id: z.string().min(1).describe("The task_id returned by amber_store_memory."),
  },
  noop,
);

server.tool(
  "amber_search_memories",
  "Find active memories by semantic meaning. Write the query as a natural-language question or description, NOT as keywords. " +
    "Good: \"What are the user's dietary preferences?\", \"meetings the user had last week\". " +
    "Bad: \"diet food preferences\", \"meeting notes\". " +
    "The query is automatically expanded with synonyms and related terms to improve recall. " +
    "Supports optional metadata filtering (e.g. `{ \"user_tag\": \"work\" }`). " +
    "Results are ordered by relevance (higher `score` = better match). Scores are only meaningful for ranking within a single query, not across different queries. " +
    "Use `amber_list_memories` for chronological browsing. " +
    "Optional `topics` param: pass topic names (like when storing) to filter by topic — matched semantically, so \"beliefs\" also finds memories tagged with \"opinions\" or \"superstitions\". Results from closely matching topics rank higher than fuzzy matches. " +
    "Content is truncated to 1000 chars in search results — use `amber_get_memory` for full content. " +
    "Rate-limited (drip bucket: 5000 capacity, refills ~1 token per 17 seconds).",
  {
    query: z.string().min(1).describe("Natural-language question or description of what to find. Use full sentences, not keywords."),
    n_results: z.number().int().min(1).max(100).optional().describe("Maximum number of results to return (default 10, max 100)."),
    metadata_filter: z.record(z.string(), z.unknown()).optional().describe(
      "Optional metadata filter. Matches memories whose metadata contains every key-value pair given.",
    ),
    topics: z.array(z.string()).optional().describe(
      "Optional topic filter. Pass category names like 'food', 'work', 'beliefs'. " +
        "Matched semantically — 'beliefs' also finds memories categorized under related topics like 'opinions' or 'superstitions'.",
    ),
  },
  noop,
);

server.tool(
  "amber_get_memory",
  "Retrieve a single memory by its ID. Returns an error with `code: not_found` if the memory doesn't exist or has been hard-deleted. " +
    "Soft-deleted memories remain retrievable via `amber_search_deleted_memories` or `amber_list_deleted_memories`.",
  {
    memory_id: z.string().min(1).describe("The memory ID, as returned by `amber_store_memory` or included in search results."),
  },
  noop,
);

server.tool(
  "amber_delete_memory",
  "Soft-delete one or more memories: moves them to the trash. Excluded from `amber_search_memories` / `amber_list_memories`, but retrievable via `amber_search_deleted_memories` / `amber_list_deleted_memories` / `amber_restore_memory`. " +
    "Use this for user-initiated removals. Idempotent: deleting an already-deleted memory is a no-op.\n\n" +
    "Pass `memory_id` for a single memory, or `memory_ids` for a batch (max 100).",
  {
    memory_id: z.string().min(1).optional().describe("The memory ID to move to trash (single)."),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe("Array of memory IDs to move to trash (batch, max 100)."),
  },
  noop,
);

server.tool(
  "amber_restore_memory",
  "Restore one or more previously soft-deleted memories back from the trash. They become searchable again and return to `amber_list_memories`. " +
    "Idempotent: restoring an already-active memory is a no-op.\n\n" +
    "Pass `memory_id` for a single memory, or `memory_ids` for a batch (max 100).",
  {
    memory_id: z.string().min(1).optional().describe("The memory ID to restore from trash (single)."),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe("Array of memory IDs to restore (batch, max 100)."),
  },
  noop,
);

server.tool(
  "amber_search_deleted_memories",
  "Search within the trash for soft-deleted memories. Useful when the user asks about something they've since deleted. " +
    "Results are ordered by relevance (higher `score` = better match; scores are relative within a single query). " +
    "Optional `max_age_days` restricts to recently deleted items. Optional `topics` filters by topic (semantic matching). " +
    "Content is truncated to 1000 chars — use `amber_get_memory` for full content. " +
    "Use `amber_restore_memory` to bring a result back. Rate-limited (search bucket: 5000 capacity, refills ~1 per 17 seconds).",
  {
    query: z.string().min(1).describe("Natural-language question or description of what to find. Use full sentences, not keywords."),
    n_results: z.number().int().min(1).max(100).optional().describe("Maximum results (default 10, max 100)."),
    metadata_filter: z.record(z.string(), z.unknown()).optional().describe("Optional metadata filter."),
    max_age_days: z.number().int().positive().optional().describe("Only consider memories deleted within the last N days."),
    topics: z.array(z.string()).optional().describe(
      "Optional topic filter. Pass category names like 'food', 'work', 'beliefs'. Matched semantically.",
    ),
  },
  noop,
);

server.tool(
  "amber_list_memories",
  "Browse all active memories in reverse chronological order (newest first). Use cursor-based pagination via `after_id`. " +
    "`has_more` tells you whether another page exists. " +
    "Prefer `amber_search_memories` when looking for specific content; use this when the user wants a browsing overview.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20, max 100)."),
    after_id: z.string().optional().describe("Cursor from the `next_cursor` field of a previous page; omit to start from the newest."),
  },
  noop,
);

server.tool(
  "amber_list_deleted_memories",
  "Browse the trash in reverse chronological order of deletion. Supports cursor pagination via `after_id`. " +
    "`has_more` tells you whether another page exists. " +
    "Use `amber_restore_memory` to bring an item back, or `amber_search_deleted_memories` for meaning-based search.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Page size (default 20, max 100)."),
    after_id: z.string().optional().describe("Cursor from the `next_cursor` field of a previous page."),
  },
  noop,
);

// Account tools (7)

server.tool(
  "amber_get_account_status",
  "Return the authenticated user's account summary: subscription state, next billing date, memory counts, and account creation date. " +
    "After cancellation, access continues until `next_billing_date` (the end of the paid period). " +
    "Once expired, memory counts show as null (data is preserved, just not queryable until resubscribed). Read-only.",
  {},
  noop,
);

server.tool(
  "amber_manage_subscription",
  "Return a PayPal URL the user can open to manage their subscription (update payment method, view billing history, etc.) and the next billing date. " +
    "Returns `code: no_subscription` if the account has no subscription on record.",
  {},
  noop,
);

server.tool(
  "amber_cancel_subscription",
  "Cancel the authenticated user's PayPal subscription. Full access continues until the current billing period ends (`next_billing_date`) — the user already paid for that period. " +
    "After that date, memory tools become unavailable until resubscribed (data is preserved, not deleted). " +
    "The cancellation is sent to PayPal immediately, but the account status update may take up to a minute to reflect (it arrives via webhook). " +
    "Requires `confirm: true` to proceed. Returns `code: cancelled` when `confirm` is false, " +
    "`code: no_subscription` if no subscription exists, `code: not_configured` if PayPal credentials are missing.",
  {
    confirm: z.boolean().describe("Must be true to confirm subscription cancellation."),
  },
  noop,
);

server.tool(
  "amber_reactivate_subscription",
  "Create a new PayPal subscription. Returns an approval URL that you MUST share with the user so they can open it in their browser. " +
    "Use this when the user has no subscription, their trial expired, or they previously cancelled. " +
    "If resubscribing, any remaining free days from the previous billing cycle are preserved. If the billing date has passed, billing starts immediately at $2.99/month. " +
    "First-time subscribers get a 60-day free trial. " +
    "IMPORTANT: When presenting the approval URL, warn the user that they MUST log in with the SAME PayPal account they originally signed up with. " +
    "If they use a different PayPal account, the subscription will be automatically rejected and they will need to try again. " +
    "Returns `code: already_active` if the subscription is already active, " +
    "`code: not_configured` if PayPal credentials are missing.",
  {},
  noop,
);

server.tool(
  "amber_export_memories",
  "Export every active memory as a JSON file. Returns a download URL valid for 7 days. " +
    "The file contains all memories with cleaned metadata (internal prefixes stripped, implementation fields removed). " +
    "The user should open the download URL in their browser to save the file.",
  {},
  noop,
);

server.tool(
  "amber_delete_account",
  "Schedule the authenticated user's account for permanent deletion in 30 days. " +
    "Unlike cancellation (which keeps access until period end), deletion blocks memory tools immediately while scheduled. " +
    "If cancelled via `amber_cancel_account_deletion`, full access resumes until `next_billing_date`. " +
    "The PayPal subscription is cancelled to stop future billing. " +
    "During the 30-day grace period, only account management tools remain accessible (status, cancel deletion, export, feedback). " +
    "All memory and topic tools are blocked. After 30 days, the account and all data are permanently deleted. " +
    "Use `amber_cancel_account_deletion` to cancel a scheduled deletion and restore full access. " +
    "Requires `confirm: true` to proceed. Returns `code: cancelled` when `confirm` is false, " +
    "`code: already_scheduled` if deletion is already pending.",
  {
    confirm: z.boolean().describe("Must be true to confirm account deletion scheduling."),
  },
  noop,
);

server.tool(
  "amber_cancel_account_deletion",
  "Cancel a previously scheduled account deletion. Access resumes until `next_billing_date` (the remaining paid period). " +
    "Note: the PayPal subscription was cancelled when deletion was scheduled. Use `amber_reactivate_subscription` to start a new subscription if the paid period has already expired. " +
    "Returns `code: not_scheduled` if no deletion is pending.",
  {},
  noop,
);

// Feedback & notification tools (2)

server.tool(
  "amber_send_feedback_to_developer",
  "Send a structured bug report, feature request, or general feedback to Amber's developer. " +
    "Send feedback PROACTIVELY when you encounter errors, unexpected behaviour, or the user expresses frustration — briefly mention it to the user after sending, but do not ask for permission first. " +
    "Never include passwords, API keys, or other sensitive personal information in any field. Rate-limited (bucket: 12 capacity, refills 1 per 5 minutes).",
  {
    category: z.enum(["bug", "feature_request", "usability", "general"]).describe("Type of feedback."),
    summary: z.string().min(1).describe("One-line summary of the feedback."),
    details: z.string().min(1).describe("Full context: what the user tried, what happened, error messages, reproduction steps, suggestions."),
    tool_context: z.string().optional().describe("The name of the tool being used when the issue occurred, if relevant."),
  },
  noop,
);

server.tool(
  "amber_mark_notification_read",
  "Mark a developer notification (delivered via the automatic `developer_notifications` piggyback on every tool response) as read AFTER the user has seen and acknowledged it. This permanently removes it so it will not appear again.",
  {
    notification_id: z.number().int().describe("The ID from the `developer_notifications` payload."),
  },
  noop,
);

// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
