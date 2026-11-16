// node:http server that receives Claude Code HTTP hooks and holds the blocking ones in the queue.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { RELEASE } from './answers.js';

const HOOK_PATH = '/agent-hud/hook';
const MAX_BODY = 1024 * 1024;

export function createHookServer({ port = 0, secret, queue, isInteractive, replyOptIn, onEvent, onError = (e) => console.error(e) } = {}) {
  const safeError = (err) => { try { onError(err); } catch { /* never break a request */ } };

  const sendEmpty = (res, status = 200) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status);
    res.end();
  };
  const sendAnswer = (res, response) => {
    if (res.writableEnded || res.destroyed) return;
    if (response === RELEASE || response == null) return sendEmpty(res);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(response));
  };

  function hold(res, item) {
    // 'close' before the response is finished means the client went away.
    res.on('close', () => { if (!res.writableEnded) queue.drop(item.id); });
    queue.add(item).then((response) => sendAnswer(res, response), safeError);
  }

  function route(body, res) {
    const sessionId = body.session_id;
    const event = body.hook_event_name;
    const toolName = body.tool_name;

    if (event === 'UserPromptSubmit') {
      const synthetic = typeof body.prompt === 'string' && body.prompt.trim().startsWith('<task-notification>');
      if (!synthetic) queue.releaseSession(sessionId, ['reply']);
    }
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      for (const it of queue.list()) {
        if (it.kind === 'permission' && it.sessionId === sessionId && it.payload?.tool_name === toolName) queue.answer(it.id, RELEASE);
      }
    }

    let kind = null;
    if (event === 'PermissionRequest' && isInteractive(sessionId)) kind = 'permission';
    else if (event === 'PreToolUse' && toolName === 'AskUserQuestion' && isInteractive(sessionId)) kind = 'choice';
    else if (event === 'Stop' && isInteractive(sessionId) && replyOptIn(sessionId)) {
      const running = Array.isArray(body.background_tasks) && body.background_tasks.some((t) => t?.status === 'running');
      if (!running) kind = 'reply';
    }

    if (!kind) return sendEmpty(res);
    hold(res, { id: randomUUID(), sessionId, kind, payload: body });
  }

  function handle(req, res) {
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== HOOK_PATH) {
      req.resume();
      return sendEmpty(res, 404);
    }
    if (req.headers['x-agent-hud'] !== secret) {
      req.resume();
      return sendEmpty(res, 403);
    }

    const declared = Number(req.headers['content-length']);
    let size = 0;
    let tooBig = false;
    const chunks = [];
    const reject = () => {
      if (tooBig) return;
      tooBig = true;
      chunks.length = 0;
      res.setHeader('connection', 'close');
      sendEmpty(res, 413);
    };
    if (declared > MAX_BODY) reject();

    req.on('data', (c) => {
      if (tooBig) return;
      size += c.length;
      if (size > MAX_BODY) return reject();
      chunks.push(c);
    });
    req.on('error', safeError);
    req.on('end', () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return sendEmpty(res); }
      if (!body || typeof body !== 'object' || !body.hook_event_name) return sendEmpty(res);

      if (onEvent) {
        try {
          onEvent({ sessionId: body.session_id, event: body.hook_event_name, toolName: body.tool_name, toolInput: body.tool_input, cwd: body.cwd, at: Date.now(), raw: body });
        } catch (err) { safeError(err); }
      }
      try { route(body, res); } catch (err) { safeError(err); sendEmpty(res); }
    });
  }

  const server = http.createServer(handle);

  return {
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
      });
    },
    close() {
      return new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        queue.releaseAll();
        // Let the released empty 200s flush, then drop any idle keep-alive sockets.
        setTimeout(() => { server.closeIdleConnections?.(); server.closeAllConnections?.(); }, 50).unref?.();
      });
    },
  };
}
