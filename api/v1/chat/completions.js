// api/v1/chat/completions.js
import crypto from 'crypto';
import { verifyKey } from '../../_lib/auth.js';
import { checkRateLimit } from '../../_lib/rateLimit.js';
import { chatWithUpstream } from '../../_lib/upstream.js';

function openaiError(message, type = 'invalid_request_error', code = null) {
  return { error: { message, type, code, param: null } };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json(openaiError('Method not allowed'));

  // --- Auth ---
  const auth = verifyKey(req);
  if (!auth.ok) return res.status(auth.code).json(openaiError(auth.error, 'authentication_error', 'invalid_api_key'));

  // --- Rate limit ---
  const rpm = auth.info.rpm || 20;
  const rl = await checkRateLimit(auth.key, rpm);
  res.setHeader('X-RateLimit-Limit', rpm);
  res.setHeader('X-RateLimit-Remaining', rl.remaining);
  if (!rl.allowed) {
    return res.status(429).json(openaiError(`Rate limit ${rpm} rpm exceeded.`, 'rate_limit_error'));
  }

  // --- Body ---
  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json(openaiError('Invalid JSON body'));
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  
  // System Prompt এবং User Message আলাদা করি
  const systemMsg = messages.find(m => m.role === 'system');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  
  if (!lastUser) return res.status(400).json(openaiError('messages must include a user message'));

  // --- Prompt Construction ---
  let prompt = '';

  // ১. System Instructions (যদি থাকে)
  if (systemMsg) {
    let sysText = '';
    if (typeof systemMsg.content === 'string') sysText = systemMsg.content;
    else if (Array.isArray(systemMsg.content)) {
      sysText = systemMsg.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
    }
    if (sysText.trim()) {
      prompt += `[System Instructions]:\n${sysText.trim()}\n\n`;
    }
  }

  // ২. User Message
  let userText = '';
  if (typeof lastUser.content === 'string') {
    userText = lastUser.content;
  } else if (Array.isArray(lastUser.content)) {
    userText = lastUser.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  } else {
    userText = String(lastUser.content || '');
  }

  prompt += `[User]:\n${userText.trim()}`;

  if (!prompt.trim()) return res.status(400).json(openaiError('Message content is empty'));

  // --- Upstream call ---
  let result;
  try {
    result = await chatWithUpstream(prompt);
  } catch (err) {
    return res.status(502).json(openaiError(`Upstream error: ${err.message}`, 'api_error'));
  }

  const id = 'chatcmpl-' + crypto.randomBytes(12).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  const model = body.model || 'ibrahim-khalil-v1';

  // --- Streaming mode (single chunk since upstream isn't truly streaming) ---
  if (body.stream === true) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: { role: 'assistant', content: result.text }, finish_reason: null }]
    })}\n\n`);

    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    })}\n\n`);

    res.write('data: [DONE]\n\n');
    return res.end();
  }

  // --- Non-streaming ---
  return res.status(200).json({
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: result.text },
      finish_reason: 'stop'
    }],
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 4),
      completion_tokens: Math.ceil(result.text.length / 4),
      total_tokens: Math.ceil((prompt.length + result.text.length) / 4)
    }
  });
}
