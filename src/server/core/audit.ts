import type {
  ContentItem,
  ModerationDecision,
} from './types.js';

export interface AuditDatabaseConfig {
  supabaseUrl: string;
  supabaseServiceKey: string;
}

export type AuditExecutionStatus =
  | 'pending'
  | 'completed'
  | 'failed';

export type AuditExecutionResult =
  | 'recommendation_only'
  | 'approved'
  | 'removed_silently'
  | 'removed_with_public_reply'
  | 'removed_and_notified';

function auditUrl(config: AuditDatabaseConfig): string {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    throw new Error('Supabase audit settings are not configured');
  }

  return `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/moderation_audit`;
}

function auditHeaders(config: AuditDatabaseConfig): HeadersInit {
  return {
    'content-type': 'application/json',
    apikey: config.supabaseServiceKey,
    Authorization: `Bearer ${config.supabaseServiceKey}`,
  };
}

async function throwAuditError(
  response: Response,
  operation: string
): Promise<never> {
  throw new Error(
    `Supabase audit ${operation} failed: ${response.status} ${await response.text()}`
  );
}

export async function createModerationAudit(
  config: AuditDatabaseConfig,
  input: {
    subredditId: string;
    item: ContentItem;
    source: string;
    decision: ModerationDecision;
  }
): Promise<string> {
  const response = await fetch(auditUrl(config), {
    method: 'POST',
    headers: {
      ...auditHeaders(config),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      subreddit_id: input.subredditId,
      item_id: input.item.id,
      item_kind: input.item.kind,
      source: input.source,
      action: input.decision.action,
      confidence: input.decision.confidence,
      summary: input.decision.summary,
      matched_rules: input.decision.matchedRules,
      policy_references: input.decision.policyReferences,
      execution_status: 'pending',
      execution_result: 'recommendation_only',
    }),
  });

  if (!response.ok) {
    await throwAuditError(response, 'insert');
  }

  const rows = await response.json() as { id?: string }[];
  const id = rows[0]?.id;

  if (!id) {
    throw new Error('Supabase audit insert returned no row ID');
  }

  return id;
}

export async function completeModerationAudit(
  config: AuditDatabaseConfig,
  id: string,
  status: Exclude<AuditExecutionStatus, 'pending'>,
  result: AuditExecutionResult,
  errorDetail?: string
): Promise<void> {
  const url = new URL(auditUrl(config));
  url.searchParams.set('id', `eq.${id}`);

  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...auditHeaders(config),
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      execution_status: status,
      execution_result: result,
      error_detail: errorDetail?.slice(0, 1000) ?? null,
    }),
  });

  if (!response.ok) {
    await throwAuditError(response, 'update');
  }

  const rows = await response.json() as { id?: string }[];
  if (rows.length !== 1 || rows[0]?.id !== id) {
    throw new Error('Supabase audit update did not update exactly one row');
  }
}

export async function deleteExpiredModerationAudits(
  config: AuditDatabaseConfig,
  retentionDays = 30
): Promise<number> {
  const url = new URL(auditUrl(config));
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();
  url.searchParams.set('created_at', `lt.${cutoff}`);

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...auditHeaders(config),
      Prefer: 'return=representation',
    },
  });

  if (!response.ok) {
    await throwAuditError(response, 'cleanup');
  }

  const rows = await response.json() as { id: string }[];
  return rows.length;
}