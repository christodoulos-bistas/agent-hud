// node:http server that receives Claude Code HTTP hooks and holds the blocking ones in the queue.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { RELEASE } from './answers.js';

const HOOK_PATH = '/agent-hud/hook';
const MAX_BODY = 1024 * 1024;
const HARD_CAP = 16 * 1024 * 1024;

// shouldHold(): false while nobody can answer (HUD hidden, renderer gone); blocking events then pass
// straight through with an empty 200.
export function createHookServer({ port = 0, secret, queue, isInteractive, replyOptIn, shouldHold = () => true, onEvent, onError = (e) => console.error(e) } = {}) {
  const safeError = (err) => { try { onError(err); } catch { /* never break a request */ } };
  const canHold = () => {
    try { return !!shouldHold(); } catch (err) { safeError(err); return false; }
  };

  const sendEmpty = (res, status = 200) => {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status);
    res.end();
  };
  const sendAnswer = (res, response) => {
    if (res.writableEnded || res.destroyed) return;
    if (response === RELEASE || response == null) return sendEmpty(res);
    const text = JSON.stringify(response);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(text);
  };

  function hold(res, item) {
    // 'close' before the response is finished means the client went away.
    res.on('close', () => { if (!res.writableEnded) queue.drop(item.id); });
    Promise.resolve().then(() => queue.add(item)).then((response) => sendAnswer(res, response)).catch((err) => {
      safeError(err);
      if (!res.headersSent) sendEmpty(res); else res.destroy();
    });
  }

  // The main thread moved on (its turn ended, or the user typed a new prompt), so any question it was
  // holding was answered elsewhere: release it. Subagent questions (agent_id set) are left alone.
  function releaseMainQuestions(sessionId) {
    for (const it of queue.list()) {
      if ((it.kind === 'permission' || it.kind === 'choice') && it.sessionId === sessionId && (it.payload?.agent_id ?? null) === null) {
        queue.answer(it.id, RELEASE);
      }
    }
  }

  function route(body, res) {
    const sessionId = body.session_id;
    const event = body.hook_event_name;
    const toolName = body.tool_name;
    const bgRunning = Array.isArray(body.background_tasks) && body.background_tasks.some((t) => t?.status === 'running');

    if (event === 'UserPromptSubmit') {
      const synthetic = typeof body.prompt === 'string' && body.prompt.trim().startsWith('<task-notification>');
      if (!synthetic) {
        queue.releaseSession(sessionId, ['reply']);
        releaseMainQuestions(sessionId);
      }
    }
    if (event === 'Stop' && !bgRunning) releaseMainQuestions(sessionId);
    if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
      // The same thread (main, or the same subagent) ran exactly this call: its question was answered natively.
      const agentId = body.agent_id ?? null;
      for (const it of queue.list()) {
        if (it.kind === 'permission' && it.sessionId === sessionId && it.payload?.tool_name === toolName &&
          (it.payload?.agent_id ?? null) === agentId && isDeepStrictEqual(it.payload?.tool_input, body.tool_input)) {
          queue.answer(it.id, RELEASE);
        }
      }
    }

    let kind = null;
    // AskUserQuestion's PermissionRequest is never held: its PreToolUse already is the choice card (I4).
    if (event === 'PermissionRequest' && toolName !== 'AskUserQuestion' && isInteractive(sessionId)) kind = 'permission';
    else if (event === 'PreToolUse' && toolName === 'AskUserQuestion' && isInteractive(sessionId)) kind = 'choice';
    else if (event === 'Stop' && !bgRunning && isInteractive(sessionId) && replyOptIn(sessionId)) kind = 'reply';

    if (!kind || !canHold()) return sendEmpty(res);
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
    let discarded = 0;
    const chunks = [];
    const reject = () => {
      if (tooBig) return;
      tooBig = true;
      chunks.length = 0;
      sendEmpty(res, 413);
    };
    if (declared > MAX_BODY) reject();

    req.on('data', (c) => {
      if (tooBig) {
        // Lingering close: keep discarding so the client can finish sending and read the 413.
        discarded += c.length;
        if (discarded > HARD_CAP) req.destroy();
        return;
      }
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
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          server.on('error', safeError); // a later error must not become an uncaught exception
          resolve(server.address().port);
        });
      });
    },
    get httpServer() { return server; },
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
