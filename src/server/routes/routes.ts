import { createServer } from 'node:http';
import { Hono } from 'hono';
import {
  processContent,
  scanModQueue,
} from '../core/moderation.js';

import type { ContentItem } from '../core/types.js';

const app = new Hono();
const port = Number(process.env.WEBBIT_PORT) || 3000;

const server = createServer(async (request, response) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const headerValue of value) {
          headers.append(name, headerValue);
        }
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const requestUrl = `http://${request.headers.host ?? '127.0.0.1'}${request.url ?? '/'}`;
    const fetchRequest = new Request(requestUrl, {
      method: request.method,
      headers,
      body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    });

    const result = await app.fetch(fetchRequest);
    const body = Buffer.from(await result.arrayBuffer());

    response.statusCode = result.status;
    result.headers.forEach((value, name) => {
      response.setHeader(name, value);
    });
    response.end(body);
  } catch (error) {
    console.error('Server request failed:', error);
    response.statusCode = 500;
    response.end(JSON.stringify({ error: 'internal server error' }));
  }
});

server.listen(port, '0.0.0.0');

/**
 * Health check.
 *
 * Useful during development to verify that the Hono
 * application is actually being loaded.
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'mm-ai-mod',
  });
});

/**
 * App installation.
 */
app.post('/internal/triggers/app-install', async (c) => {
  console.log('AI moderator installed');

  return c.json({
    status: 'ok',
    message: 'AI moderator installed successfully',
  });
});

/**
 * Process a reported post.
 */
app.post('/internal/triggers/post-report', async (c) => {
  try {
    const body = await c.req.json();

    const content: ContentItem = {
      id: String(body.id),
      kind: 'post',
      title: body.title,
      body: String(body.body ?? ''),
      author: body.author,
      permalink: body.permalink,
    };

    const result = await processContent(content, 'post-report');

    return c.json({
      status: 'ok',
      result,
    });
  } catch (error) {
    console.error('Post report processing failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Process a reported comment.
 */
app.post('/internal/triggers/comment-report', async (c) => {
  try {
    const body = await c.req.json();

    const content: ContentItem = {
      id: String(body.id),
      kind: 'comment',
      body: String(body.body ?? ''),
      author: body.author,
      permalink: body.permalink,
    };

    const result = await processContent(content, 'comment-report');

    return c.json({
      status: 'ok',
      result,
    });
  } catch (error) {
    console.error('Comment report processing failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Process Modmail.
 *
 * This is currently a placeholder for the Modmail workflow.
 * We intentionally do not automatically perform moderation
 * actions here yet.
 */
app.post('/internal/triggers/modmail', async (c) => {
  try {
    const body = await c.req.json();

    console.log('Received Modmail event:', body);

    return c.json({
      status: 'ok',
      message: 'Modmail event received',
    });
  } catch (error) {
    console.error('Modmail processing failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Scheduled mod-queue scan.
 */
app.post('/internal/scheduler/scan-mod-queue', async (c) => {
  try {
    const results = await scanModQueue();

    return c.json({
      status: 'ok',
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('Mod queue scan failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Manually review the selected post/comment.
 *
 * This is particularly useful during development because
 * it allows you to test RAG + Gemini without waiting for
 * a Reddit event.
 */
app.post('/internal/menu/ai-review', async (c) => {
  try {
    const body = await c.req.json();

    const content: ContentItem = {
      id: String(body.id),
      kind: body.kind === 'comment' ? 'comment' : 'post',
      title: body.title,
      body: String(body.body ?? ''),
      author: body.author,
      permalink: body.permalink,
    };

    const result = await processContent(content, 'manual-ai-review');

    return c.json({
      status: 'ok',
      result,
    });
  } catch (error) {
    console.error('Manual AI review failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Manually scan the mod queue.
 */
app.post('/internal/menu/scan-mod-queue', async (c) => {
  try {
    const results = await scanModQueue();

    return c.json({
      status: 'ok',
      processed: results.length,
      results,
    });
  } catch (error) {
    console.error('Manual mod queue scan failed:', error);

    return c.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});

/**
 * Catch-all route.
 */
app.notFound((c) => {
  return c.json(
    {
      error: 'not found',
      path: c.req.path,
    },
    404
  );
});

/**
 * Global error handler.
 */
app.onError((error, c) => {
  console.error('Unhandled server error:', error);

  return c.json(
    {
      status: 'error',
      error: error.message,
    },
    500
  );
});

export default app;
export { app };