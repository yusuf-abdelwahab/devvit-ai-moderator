import { reddit, redis } from '@devvit/web/server';
import { getConfig } from './config.js';
import { moderateWithGemini } from './gemini.js';
import { retrievePolicy } from './rag.js';

import type {
  ContentItem,
  ModerationDecision,
} from './types.js';

const lockKey = (id: string) =>
  `ai-mod:processed:${id}`;

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
  if (item.kind === 'post') {
    await reddit.remove(
      `t3_${item.id}` as `t3_${string}`,
      false
    );
  } else {
    await reddit.remove(
      `t1_${item.id}` as `t1_${string}`,
      false
    );
  }
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

  return moderateWithGemini(
    config.geminiApiKey,
    item,
    chunks
  );
}

export async function processContent(
  item: ContentItem,
  source: string
) {
  const config = await getConfig();

  if (!config.enabled) {
    return {
      status: 'disabled' as const,
    };
  }

  const existing = await redis.get(
    lockKey(item.id)
  );

  if (existing) {
    return {
      status: 'duplicate' as const,
    };
  }

  const decision = await analyzeContent(item);

  //BAN_PENDING NEVER performs a ban.  It only notifies human moderators.
  if (decision.action === 'BAN_PENDING') {
    await notifyBanPending(
      item,
      decision
    );
  }

  //Automatic removal is separately controlled by configuration and confidence threshold.
  if (
    decision.action === 'REMOVE' &&
    config.autoRemove &&
    decision.confidence >= config.threshold
  ) {
    await executeRemoval(item);
  }

  //Only mark the item processed after the moderation workflow has completed successfully.
  await redis.set(
    lockKey(item.id),
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