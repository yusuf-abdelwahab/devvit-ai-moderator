import { createServer, getServerPort, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type { T1, T3 } from '@devvit/shared-types/tid.js';
import {
  processContent,
  scanModQueue,
} from '../core/moderation.js';

import type { ContentItem } from '../core/types.js';

const app = new Hono();
const port = getServerPort();

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

//Verifies that the Hono application is properly loaded.
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'mm-ai-mod',
  });
});

//App installation.
app.post('/internal/triggers/app-install', async (c) => {
  console.log('AI moderator installed');

  return c.json({
    status: 'ok',
    message: 'AI moderator installed successfully',
  });
});

//Process a reported post.
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

//Process a reported comment.
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

//TODO: Process Modmail.
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

//Scheduled mod-queue scan.
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

//Manually review the selected post/comment.
app.post('/internal/menu/ai-review', async (c) => {
  try {
    const body = await c.req.json();
    const targetId = String(body.targetId ?? '');
    const location = body.location;

    let content: ContentItem;

    if (location === 'comment' && targetId.startsWith('t1_')) {
      const comment = await reddit.getCommentById(targetId as T1);
      content = {
        id: String(comment.id).slice(3),
        kind: 'comment',
        body: comment.body,
        author: comment.authorName,
        permalink: `https://www.reddit.com${comment.permalink}`,
      };
    } else if (location === 'post' && targetId.startsWith('t3_')) {
      const post = await reddit.getPostById(targetId as T3);
      content = {
        id: String(post.id).slice(3),
        kind: 'post',
        title: post.title,
        body: post.body ?? '',
        author: post.authorName,
        permalink: `https://www.reddit.com${post.permalink}`,
      };
    } else {
      return c.json({
        showToast: {
          text: 'Could not identify the selected post or comment.',
        },
      });
    }

    const result = await processContent(content, 'manual-ai-review');

    const text = result.status === 'processed'
      ? `AI review: ${result.decision?.action ?? 'REVIEW'} (${Math.round((result.decision?.confidence ?? 0) * 100)}%). ${result.decision?.summary ?? ''}`
      : result.status === 'duplicate'
        ? 'This item has already been processed.'
        : 'AI moderation is currently disabled.';

    return c.json({ showToast: { text: text.slice(0, 400) } });
  } catch (error) {
    console.error('Manual AI review failed:', error);

    return c.json({
      showToast: {
        text: 'AI review failed. Check the app logs for details.',
      },
    });
  }
});

//Manually scan the mod queue
app.post('/internal/menu/scan-mod-queue', async (c) => {
  try {
    const results = await scanModQueue();

    return c.json({
      showToast: {
        text: `Mod queue scan finished. ${results.length} item(s) processed.`,
      },
    });
  } catch (error) {
    console.error('Manual mod queue scan failed:', error);

    return c.json({
      showToast: {
        text: 'Mod queue scan failed. Check the app logs for details.',
      },
    });
  }
});

//Catch-all route
app.notFound((c) => {
  return c.json(
    {
      error: 'not found',
      path: c.req.path,
    },
    404
  );
});

//Global error handler.
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