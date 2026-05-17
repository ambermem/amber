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
  "Check the processing status of a memory store task. Call this after `amber_store_memory` to confirm processing completed. " +
    "Not rate-limited. Read-only. Requires an active subscription.\n\n" +
    "Statuses: `pending` (queued), `processing` (in progress), `completed` (done, memory_ids available), `error` (permanently failed).\n\n" +
    "Processing phases (shown in `progress` field): chunking → expanding/embedding chunks (parallel) → resolving topics (parallel search, sequential creation) → inserting memories (parallel). " +
    "If processing fails (e.g. LLM timeout), it retries up to 3 times. No duplicates are created on retry. " +
    "Only after all retries are exhausted does the status become `error` with the failure reason.\n\n" +
    "Returns `code: not_found` if the task_id doesn't exist or has expired (tasks are pruned after 7 days).",
  {
    task_id: z.string().min(1).describe(
      "UUID from `amber_store_memory`'s response. Poll this to know when memories are ready to search. Invalid IDs return `code: not_found`.",
    ),
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
  "Retrieve a single memory by its ID with full, untruncated content. " +
    "Use this after `amber_search_memories` when a result's content was truncated (indicated by `truncated: true`), or when you have a memory_id from a previous interaction and need the complete text.\n\n" +
    "Returns the memory with its full content, metadata (if any), topic names (if any), and created_at timestamp. " +
    "Returns `code: not_found` if the memory doesn't exist, was hard-deleted, or is currently in the trash. " +
    "To access soft-deleted memories, use `amber_search_deleted_memories` or `amber_list_deleted_memories` instead. " +
    "Read-only — does not modify the memory. Not rate-limited. Requires an active subscription.",
  {
    memory_id: z.string().min(1).describe(
      "UUID of the memory to retrieve. Use this to fetch full content after seeing a truncated search result, or to revisit a known memory. Invalid or trashed IDs return `code: not_found`.",
    ),
  },
  noop,
);

server.tool(
  "amber_delete_memory",
  "Soft-delete one or more memories: moves them to the trash. Excluded from `amber_search_memories` / `amber_list_memories`, but retrievable via `amber_search_deleted_memories` / `amber_list_deleted_memories` / `amber_restore_memory`. " +
    "Use this for user-initiated removals. Idempotent: deleting an already-deleted memory is a no-op.\n\n" +
    "Pass `memory_id` for a single memory, or `memory_ids` for a batch (max 100). Must provide at least one. " +
    "Returns `deleted_count` with the number of memories actually moved to trash (excludes already-deleted ones). " +
    "Returns `code: not_found` if none of the given IDs matched active memories.",
  {
    memory_id: z.string().min(1).optional().describe(
      "A single memory ID (UUID) to move to trash. Use this for individual deletions. Mutually optional with memory_ids — provide at least one.",
    ),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe(
      "Array of memory IDs (UUIDs) to move to trash in a single batch (max 100). Use this for bulk deletions. Mutually optional with memory_id — provide at least one.",
    ),
  },
  noop,
);

server.tool(
  "amber_restore_memory",
  "Restore one or more previously soft-deleted memories back from the trash. They become searchable again and return to `amber_list_memories`. " +
    "Idempotent: restoring an already-active memory is a no-op.\n\n" +
    "Pass `memory_id` for a single memory, or `memory_ids` for a batch (max 100). Must provide at least one. " +
    "Returns `restored_count` with the number of memories actually restored (excludes already-active ones). " +
    "Returns `code: not_found` if none of the given IDs matched deleted memories.",
  {
    memory_id: z.string().min(1).optional().describe(
      "A single memory ID (UUID) to restore from trash. Use this for individual restores. Mutually optional with memory_ids — provide at least one.",
    ),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe(
      "Array of memory IDs (UUIDs) to restore from trash in a single batch (max 100). Use this for bulk restores. Mutually optional with memory_id — provide at least one.",
    ),
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
    "Prefer `amber_search_memories` when looking for specific content; use this when the user wants a browsing overview or asks \"show me my recent memories\".\n\n" +
    "Each result includes full content (not truncated), metadata, topics, and creation timestamp. " +
    "Read-only — does not modify any memories. Not rate-limited. Requires an active subscription.\n\n" +
    "Returns `memories` array, `next_cursor` (null if no more pages), and `has_more` boolean.",
  {
    limit: z.number().int().min(1).max(100).optional().describe(
      "Number of memories per page (default 20, min 1, max 100). Use smaller values (5-10) for quick overviews, larger values (50-100) for bulk browsing. Omit to use the default of 20.",
    ),
    after_id: z.string().optional().describe(
      "Pagination cursor (memory ID string). Pass the `next_cursor` value from a previous response to fetch the next page. Omit on the first call to start from the newest memory. Do not fabricate cursor values.",
    ),
  },
  noop,
);

server.tool(
  "amber_list_deleted_memories",
  "Browse the trash in reverse chronological order of deletion (most recently deleted first). Supports cursor pagination via `after_id`. " +
    "`has_more` tells you whether another page exists. " +
    "Use `amber_restore_memory` to bring an item back, or `amber_search_deleted_memories` for meaning-based search within the trash.\n\n" +
    "Each result includes full content (not truncated), metadata, topics, creation timestamp, and deletion timestamp. " +
    "Read-only — does not modify or permanently delete any memories. Not rate-limited. Requires an active subscription.\n\n" +
    "Returns `memories` array, `next_cursor` (null if no more pages), and `has_more` boolean.",
  {
    limit: z.number().int().min(1).max(100).optional().describe(
      "Number of deleted memories per page (default 20, min 1, max 100). Use smaller values (5-10) for quick checks, larger values (50-100) for bulk review. Omit to use the default of 20.",
    ),
    after_id: z.string().optional().describe(
      "Pagination cursor (memory ID string). Pass the `next_cursor` value from a previous response to fetch the next page. Omit on the first call to start from the most recently deleted memory. Do not fabricate cursor values.",
    ),
  },
  noop,
);

// Account tools (7)

server.tool(
  "amber_get_account_status",
  "Return the authenticated user's account summary: subscription state, next billing date, memory counts, and account creation date. " +
    "Use this when the user asks about their account, subscription status, or how many memories they have.\n\n" +
    "After cancellation, access continues until `next_billing_date` (the end of the paid period). " +
    "Once expired, memory counts show as null (data is preserved, just not queryable until resubscribed). " +
    "If `deletion_scheduled_at` is set, the account is pending permanent deletion — use `amber_cancel_account_deletion` to stop it. " +
    "Read-only — does not modify any account state. Not rate-limited.",
  {},
  noop,
);

server.tool(
  "amber_manage_subscription",
  "Return a PayPal URL the user can open to manage their subscription (update payment method, view billing history, change payment source) and the next billing date. " +
    "Use this when the user asks about billing, wants to change their payment method, or wants to view their subscription details.\n\n" +
    "Unlike `amber_cancel_subscription` (which cancels) or `amber_reactivate_subscription` (which creates a new subscription), " +
    "this tool only provides a link to PayPal's self-service page — no changes are made by calling it.\n\n" +
    "The URL opens PayPal's subscription management page — Amber does not handle payment details directly. " +
    "Returns `code: no_subscription` if the account has no subscription on record (use `amber_reactivate_subscription` to start one). " +
    "Read-only — does not modify the subscription. Not rate-limited.",
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
    confirm: z.boolean().describe("Set `true` to proceed, `false` to abort without changes."),
  },
  noop,
);

server.tool(
  "amber_reactivate_subscription",
  "Start or restart a PayPal subscription for the user. Returns an approval URL that you MUST present to the user to open in their browser — the subscription is not active until they approve it on PayPal.\n\n" +
    "When to use: the user has no subscription, their trial expired, they previously cancelled, or they ask to resubscribe.\n\n" +
    "Pricing: first-time subscribers get a 60-day free trial, then $2.99/month. Resubscribers keep any remaining free days from their previous billing cycle; if the billing date has passed, billing starts immediately at $2.99/month.\n\n" +
    "IMPORTANT: When presenting the approval URL, warn the user that they MUST log in with the SAME PayPal account they originally signed up with. " +
    "If they use a different PayPal account, the subscription will be automatically rejected and they will need to try again.\n\n" +
    "Side effects: creates a new PayPal subscription (pending approval). No charge occurs until the user approves. " +
    "Returns `code: already_active` if the subscription is already active (also syncs status from PayPal). " +
    "Returns `code: not_configured` if PayPal credentials are missing. " +
    "Returns `code: deletion_scheduled` if the account is scheduled for deletion — user must cancel deletion first.",
  {},
  noop,
);

server.tool(
  "amber_export_memories",
  "Export every active memory as a JSON file. Returns a download URL valid for 7 days. " +
    "The file contains all memories with cleaned metadata (internal prefixes stripped, implementation fields removed). " +
    "The user should open the download URL in their browser to save the file.\n\n" +
    "Use this when the user wants a backup, wants to migrate data, or asks \"can I download my data?\". " +
    "Unlike `amber_list_memories` (which paginates and shows one page at a time), this exports ALL memories in a single downloadable file. " +
    "Unlike `amber_search_memories` (which finds specific content), this is a complete dump.\n\n" +
    "Each call generates a fresh export — previous export URLs remain valid for their full 7-day window. " +
    "The export includes both active and deleted memories, with topics and metadata. " +
    "Large accounts (10,000+ memories) may take a few seconds to generate. " +
    "Does not modify any data — read-only operation. Requires an active subscription. Not rate-limited.",
  {},
  noop,
);

server.tool(
  "amber_delete_account",
  "Schedule permanent account deletion in 30 days. Memory tools are blocked immediately (unlike cancellation, which keeps access until period end). " +
    "Cancels the PayPal subscription. Reversible within 30 days via `amber_cancel_account_deletion`.\n\n" +
    "During the grace period: account management tools (status, export, feedback) remain accessible; memory tools are blocked. " +
    "After 30 days: all data is permanently deleted.\n\n" +
    "Requires `confirm: true`. Returns `code: cancelled` when false, `code: already_scheduled` if already pending.",
  {
    confirm: z.boolean().describe("Set `true` to proceed, `false` to abort without changes."),
  },
  noop,
);

server.tool(
  "amber_cancel_account_deletion",
  "Cancel a previously scheduled account deletion. Removes the deletion deadline and unblocks memory tools immediately. " +
    "Access resumes until `next_billing_date` (the remaining paid period). No data is lost.\n\n" +
    "Side effects: clears `deletion_scheduled_at` from the account. The PayPal subscription was already cancelled when deletion was scheduled — call `amber_reactivate_subscription` to start a new one if the paid period has expired. " +
    "Returns `code: not_scheduled` if no deletion is pending. Not rate-limited.",
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
    category: z.enum(["bug", "feature_request", "usability", "general"]).describe(
      "'bug' = broken behavior, 'feature_request' = new capability, 'usability' = confusing UX, 'general' = other.",
    ),
    summary: z.string().min(1).describe("Brief one-line summary, under 100 characters."),
    details: z.string().min(1).describe(
      "What was tried, what happened vs expected, error messages, and reproduction steps.",
    ),
    tool_context: z.string().optional().describe(
      "Which amber_ tool was in use when the issue occurred, e.g. 'amber_search_memories'.",
    ),
  },
  noop,
);

server.tool(
  "amber_mark_notification_read",
  "Mark a developer notification as read after the user has seen and acknowledged it. " +
    "Notifications are delivered automatically via the `developer_notifications` section appended to every tool response when unread notifications exist.\n\n" +
    "Call this ONLY after relaying the notification content to the user and receiving their acknowledgement. " +
    "This permanently deletes the notification — it will not appear in subsequent tool responses. " +
    "Returns `code: not_found` if the notification_id doesn't exist (already read or invalid). " +
    "Not rate-limited.",
  {
    notification_id: z.number().int().describe(
      "Numeric ID from the `developer_notifications` block in any tool response. Marks that specific notification as read and stops it from appearing. Invalid IDs return `code: not_found`.",
    ),
  },
  noop,
);

// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
