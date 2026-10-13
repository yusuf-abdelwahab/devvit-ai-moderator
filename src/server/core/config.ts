import { settings } from '@devvit/web/server';

export async function getConfig() {
  const [geminiApiKey, supabaseUrl, supabaseServiceKey, enabled, autoRemove, threshold, maxBatch] = await Promise.all([
    settings.get<string>('gemini-api-key'),
    settings.get<string>('supabase-url'),
    settings.get<string>('supabase-service-key'),
    settings.get<boolean>('ai-moderation-enabled'),
    settings.get<boolean>('auto-remove'),
    settings.get<number>('auto-remove-threshold'),
    settings.get<number>('max-batch-size')
  ]);

  return {
    geminiApiKey: geminiApiKey ?? '',
    supabaseUrl: (supabaseUrl ?? '').replace(/\/$/, ''),
    supabaseServiceKey: supabaseServiceKey ?? '',
    enabled: enabled ?? true,
    autoRemove: autoRemove ?? false,
    threshold: Math.min(1, Math.max(0, threshold ?? 0.9)),
    maxBatch: Math.min(50, Math.max(1, Math.floor(maxBatch ?? 10)))
  };
}
