export type PolicyVisibility =
  | 'public'
  | 'private';

export interface PolicyChunk {
  id: string;
  title?: string;
  text: string;
  category: string;
  visibility: PolicyVisibility;
  source: string;
  score?: number;
}

export type DecisionAction =
  | 'ALLOW'
  | 'REMOVE'
  | 'BAN_PENDING'
  | 'REVIEW';

export interface ModerationDecision {
  action: DecisionAction;
  confidence: number;
  summary: string;
  violations: string[];
  matchedRules: string[];
  policyReferences: string[];
  matchedPublicRules?: Array<{
    id: string;
    title: string;
    text: string;
  }>;
}

export interface ContentItem {
  id: string;
  kind: 'post' | 'comment';
  title?: string;
  body: string;
  author?: string;
  permalink?: string;
}

export interface ProcessingResult {
  status:
    | 'disabled'
    | 'duplicate'
    | 'processed'
    | 'error';

  decision?: ModerationDecision;

  error?: string;
}