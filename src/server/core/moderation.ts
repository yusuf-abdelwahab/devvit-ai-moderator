import { reddit, redis } from '@devvit/web/server';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import { getConfig } from './config.js';
import {
  completeModerationAudit,
  createModerationAudit,
  type AuditExecutionResult,
} from './audit.js';
import { moderateWithGemini } from './gemini.js';
import { retrievePolicy } from './rag.js';

import type {
  ContentItem,
  ModerationDecision,
  PolicyChunk,
} from './types.js';

const lockKey = (id: string) =>
  `ai-mod:processed:${id}`;

function normalizeContentId(item: ContentItem): string {
  const prefix = item.kind === 'post' ? 't3_' : 't1_';
  return item.id.startsWith(prefix)
    ? item.id.slice(prefix.length)
    : item.id;
}

async function notifyBanPending(
  item: ContentItem,
  decision: ModerationDecision
): Promise<void> {
  const subreddit = await reddit.getCurrentSubreddit();

  await reddit.modMail.createModNotification({
    subject: `AI moderation: BAN_PENDING for ${item.id}`,

    bodyMarkdown:
      `AI recommends **BAN_PENDING** for ${item.kind} ` +
      `${item.permalink ? `[view content](${item.permalink})` : item.id}\n\n` +
      `**Confidence:** ${decision.confidence.toFixed(2)}\n\n` +
      `**Summary:** ${decision.summary}\n\n` +
      `**Matched rules:** ${decision.matchedRules.join(', ') || 'None provided'}\n\n` +
      `No ban was executed. A human moderator must review this decision.`,

    subredditId: subreddit.id,
  });
}

async function executeRemoval(
  item: ContentItem
): Promise<void> {
  await reddit.remove(getThingId(item), false);
}

function getThingId(item: ContentItem): T1 | T3 {
  const id = normalizeContentId(item);
  return item.kind === 'post'
    ? `t3_${id}` as T3
    : `t1_${id}` as T1;
}

async function executeApproval(item: ContentItem): Promise<void> {
  await reddit.approve(getThingId(item));
}

export function isPublicOnlyDecision(decision: ModerationDecision): boolean {
  const decisiveRules = decision.matchedRules.length > 0
    ? decision.matchedRules
    : decision.policyReferences;
  const references = decisiveRules.join(' ').toLowerCase();

  return references.includes('public:') && !references.includes('private:');
}

export function getMatchedPublicRules(
  chunks: PolicyChunk[],
  decision: ModerationDecision
): NonNullable<ModerationDecision['matchedPublicRules']> {
  const citations = [
    ...decision.matchedRules,
    ...decision.policyReferences,
  ].map((citation) => citation.trim().toLowerCase());

  return chunks
    .filter((chunk) => {
      if (chunk.visibility !== 'public' || !chunk.title) return false;

      const id = chunk.id.toLowerCase();
      const unqualifiedId = id.startsWith('public:')
        ? id.slice('public:'.length)
        : id;

      return citations.some((citation) =>
        citation.includes(id) ||
        citation.includes(unqualifiedId) ||
        citation === chunk.title?.trim().toLowerCase()
      );
    })
    .map(({ id, title, text }) => ({ id, title: title!, text }));
}

async function replyWithPublicRemoval(
  item: ContentItem,
  decision: ModerationDecision
): Promise<void> {
  const rules = decision.matchedPublicRules ?? [];
  if (!rules.length) {
    throw new Error('Public-only removal has no matched public rule text');
  }

  const ruleText = rules
    .map((rule) => `**${rule.title}**\n${rule.text}`)
    .join('\n\n');

  const response = await reddit.submitComment({
    id: getThingId(item),
    text:
      `Your ${item.kind} was removed for violating the following subreddit rule${rules.length > 1 ? 's' : ''}:\n\n` +
      `${ruleText}\n\n` +
      'If you believe this was a mistake, please contact the moderators through Modmail.',
    runAs: 'APP',
  });

  await response.lock();
}

export async function analyzeContent(
  item: ContentItem
): Promise<ModerationDecision> {
  const config = await getConfig();

  if (!config.geminiApiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const query = [
    item.title,
    item.body,
  ]
    .filter(Boolean)
    .join('\n\n');

  if (!query.trim()) {
    return {
      action: 'REVIEW',
      confidence: 0,
      summary: 'No content was available for analysis.',
      violations: [],
      matchedRules: [],
      policyReferences: [],
    };
  }

  let chunks: Awaited<ReturnType<typeof retrievePolicy>>;

  try {
    // Public policy is retrieved first, private policy second.
    chunks = await retrievePolicy(
      config.geminiApiKey,
      config.supabaseUrl,
      config.supabaseServiceKey,
      query,
      8
    );
  } catch (error) {
    console.error(
      'Policy retrieval failed; sending item to human review:',
      error
    );

    return {
      action: 'REVIEW',
      confidence: 0,
      summary:
        'Policy retrieval was incomplete. A human moderator must review this item.',
      violations: [],
      matchedRules: [],
      policyReferences: [],
    };
  }

  if (!chunks.length) {
    return {
      action: 'REVIEW',
      confidence: 0,
      summary: 'No relevant policy chunks were retrieved.',
      violations: [],
      matchedRules: [],
      policyReferences: [],
    };
  }

  const decision = await moderateWithGemini(
    config.geminiApiKey,
    item,
    chunks
  );

  return {
    ...decision,
    matchedPublicRules: getMatchedPublicRules(chunks, decision),
  };
}

export async function processContent(
  item: ContentItem,
  source: string
) {
  const normalizedItem = {
    ...item,
    id: normalizeContentId(item),
  };
  const config = await getConfig();

  if (!config.enabled) {
    return {
      status: 'disabled' as const,
    };
  }

  const existing = await redis.get(
    lockKey(normalizedItem.id)
  );

  if (existing) {
    return {
      status: 'duplicate' as const,
    };
  }

  const decision = await analyzeContent(normalizedItem);
  const subreddit = await reddit.getCurrentSubreddit();
  const auditId = await createModerationAudit(config, {
    subredditId: subreddit.id,
    item: normalizedItem,
    source,
    decision,
  });

  let executionResult: AuditExecutionResult = 'recommendation_only';

  try {
    // BAN_PENDING removes silently for users and notifies moderators; it never bans.
    if (decision.action === 'BAN_PENDING') {
      await executeRemoval(normalizedItem);
      executionResult = 'removed_silently';
      await notifyBanPending(normalizedItem, decision);
      executionResult = 'removed_and_notified';
    }

    // Automatic removal is separately controlled by configuration and confidence threshold.
    if (
      decision.action === 'REMOVE' &&
      config.autoRemove &&
      decision.confidence >= config.threshold
    ) {
      const publicOnly = isPublicOnlyDecision(decision);
      if (publicOnly && !decision.matchedPublicRules?.length) {
        throw new Error('Matched public rule title/text was not available');
      }

      await executeRemoval(normalizedItem);
      executionResult = 'removed_silently';

      if (publicOnly) {
        await replyWithPublicRemoval(normalizedItem, decision);
        executionResult = 'removed_with_public_reply';
      }
    }

    if (
      decision.action === 'ALLOW' &&
      decision.confidence >= 0.9
    ) {
      await executeApproval(normalizedItem);
      executionResult = 'approved';
    }

  } catch (error) {
    try {
      await completeModerationAudit(
        config,
        auditId,
        'failed',
        executionResult,
        error instanceof Error ? error.message : String(error)
      );
    } catch (auditError) {
      console.error('Failed to finalize moderation audit:', auditError);
    }

    throw error;
  }

  try {
    await completeModerationAudit(
      config,
      auditId,
      'completed',
      executionResult
    );
  } catch (error) {
    console.error(
      `Moderation action completed but audit ${auditId} could not be finalized:`,
      error
    );
  }

  //Only mark the item processed after the moderation workflow has completed successfully.
  await redis.set(
    lockKey(normalizedItem.id),
    JSON.stringify({
      source,
      action: decision.action,
      confidence: decision.confidence,
      at: Date.now(),
    })
  );

  return {
    status: 'processed' as const,
    decision,
  };
}

export async function scanModQueue() {
  const config = await getConfig();

  if (!config.enabled) {
    return [];
  }

  const subreddit =
    await reddit.getCurrentSubreddit();

  const listing =
    await subreddit.getModQueue({
      type: 'all',
    } as any);

  const items = await listing.all();

  const bounded =
    items.slice(0, config.maxBatch);

  const results: unknown[] = [];

  for (const item of bounded) {
    const anyItem = item as any;

    const content: ContentItem = {
      id: String(anyItem.id),

      kind:
        anyItem.title !== undefined
          ? 'post'
          : 'comment',

      title: anyItem.title,

      body: String(
        anyItem.body ??
        anyItem.selftext ??
        ''
      ),

      author:
        anyItem.author?.name,

      permalink:
        anyItem.permalink,
    };

    if (
      !content.body &&
      !content.title
    ) {
      continue;
    }

    try {
      const result =
        await processContent(
          content,
          'mod-queue-scan'
        );

      results.push({
        id: content.id,
        result,
      });
    } catch (error) {
      console.error(
        `Failed to process ${content.id}:`,
        error
      );

      results.push({
        id: content.id,
        status: 'error',
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return results;
}