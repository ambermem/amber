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
      "UUID of the target memory. Found in `amber_store_memory` task results, `amber_search_memories` result items, or `amber_list_memories` pages.",
    ),
  },
  noop,
);

server.tool(
  "amber_delete_memory",
  "Soft-delete one or more memories to the trash. Reversible via `amber_restore_memory`. " +
    "Do NOT use for account-level cleanup — use `amber_delete_account` instead.\n\n" +
    "Provide `memory_id` (single) or `memory_ids` (batch, max 100). At least one is required. " +
    "Idempotent: already-deleted memories are skipped. " +
    "Returns `deleted_count`. Returns `code: not_found` if no IDs matched active memories. " +
    "Requires an active subscription. Not rate-limited.",
  {
    memory_id: z.string().min(1).optional().describe(
      "UUID of a single memory to trash. Omit if using `memory_ids` for batch.",
    ),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe(
      "Array of memory UUIDs to trash in one call (max 100). Omit if using `memory_id` for single.",
    ),
  },
  noop,
);

server.tool(
  "amber_restore_memory",
  "Un-delete memories from the trash, making them searchable and visible in `amber_list_memories` again. " +
    "Use after `amber_search_deleted_memories` or `amber_list_deleted_memories` to recover accidentally deleted content. " +
    "Do NOT use for new content — use `amber_store_memory` instead.\n\n" +
    "Provide `memory_id` (single) or `memory_ids` (batch, max 100). At least one is required. " +
    "Idempotent: already-active memories are skipped. Side effects: moves memories from trash to active. " +
    "Returns `restored_count`. Returns `code: not_found` if no IDs matched deleted memories. " +
    "Requires an active subscription. Not rate-limited.",
  {
    memory_id: z.string().min(1).optional().describe(
      "UUID of a single memory to restore. Omit if using `memory_ids` for batch.",
    ),
    memory_ids: z.array(z.string().min(1)).min(1).max(100).optional().describe(
      "Array of memory UUIDs to restore in one call (max 100). Omit if using `memory_id` for single.",
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
  "Cancel the user's PayPal subscription. Access continues until `next_billing_date` (already paid). Data is preserved, not deleted. " +
    "Do NOT use if the user wants to delete their account entirely — use `amber_delete_account` instead.\n\n" +
    "Cancellation is sent to PayPal immediately; status update arrives via webhook within ~1 minute. " +
    "Returns `code: no_subscription` if none exists. Requires `confirm: true`.",
  {
    confirm: z.boolean().describe("When `true`: cancels the subscription on PayPal and updates account status. When `false`: returns `code: cancelled` with no side effects, letting you confirm intent first."),
  },
  noop,
);

server.tool(
  "amber_reactivate_subscription",
  "Create a PayPal subscription and return an approval URL. The user MUST open this URL in their browser to activate. " +
    "Do NOT use if the user just wants to manage an existing subscription — use `amber_manage_subscription` instead.\n\n" +
    "First-time: 60-day free trial, then $2.99/month. Returning: preserves remaining free days, or bills immediately if expired. " +
    "Warn the user to log in with the SAME PayPal account they originally signed up with.\n\n" +
    "No charge until the user approves. Returns `code: already_active` if active, `code: deletion_scheduled` if deletion is pending.",
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
      "Determines how the developer triages this. 'bug': something broke or returned wrong results. 'feature_request': a capability that doesn't exist yet. 'usability': works but is confusing or awkward. 'general': anything else.",
    ),
    summary: z.string().min(1).describe("One sentence, under 100 chars. E.g. 'Search misses memories stored with emoji in content'."),
    details: z.string().min(1).describe(
      "Full reproduction context. Include: exact input used, expected outcome, actual outcome, any error codes. E.g. 'Stored \"I love pizza 🍕\" but searching \"pizza emoji\" returns nothing. Expected it to match.'",
    ),
    tool_context: z.string().optional().describe(
      "The specific amber_ tool name involved, e.g. 'amber_search_memories'. Helps route the report.",
    ),
  },
  noop,
);

server.tool(
  "amber_mark_notification_read",
  "Dismiss a developer notification after the user has acknowledged it. " +
    "Permanently removes it from the `developer_notifications` block that appears in every tool response.\n\n" +
    "Side effects: deletes the notification row from the user's database. Idempotent in intent but returns `code: not_found` if already dismissed. " +
    "Only call after the user has seen the notification content. Not rate-limited.",
  {
    notification_id: z.number().int().describe(
      "Positive integer from the `id` field of a notification in `developer_notifications`. Example: if the block contains `{id: 42, message: \"...\"}`, pass 42. Each ID is unique and single-use.",
    ),
  },
  noop,
);

// Start with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
