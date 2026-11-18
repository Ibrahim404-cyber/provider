import crypto from 'crypto';

// ============================================================
// Anonymous ChatGPT Android image upload
// Working protocol: chatgpt2api-cf (verified end-to-end 200)
// Base URL MUST be backend-anon (not backend-api) for anonymous.
// 3 steps:  files -> PUT signed url -> files/process_upload_stream
// ============================================================

const BASE_URL = 'https://android.chat.openai.com/backend-anon/';
const USER_AGENT = 'ChatGPT/1.2027.000 (Android 12; SM-F741N; build 27230000)';
const APP_PACKAGE = 'com.openai.chatgpt';
const CLIENT_TYPE = 'android';

function backendUrl(path) {
  return BASE_URL + path.replace(/^\//, '');
}

// UUID-format device-id (Android অ্যাপ যেভাবে পাঠায়)
function buildDeviceId() {
  const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
  return `${randomHex(4)}-${randomHex(2)}-4${randomHex(2).substring(1)}-${(Math.floor(Math.random() * 4) + 8).toString(16)}${randomHex(2).substring(1)}-${randomHex(6)}`;
}

// UUID-স্টাইল msgId (chat.js-এর সাথে মিল)
function buildMsgId() {
  const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');
  const chunk1 = randomHex(4);
  const chunk2 = randomHex(2);
  const chunk3 = '4' + randomHex(2).substring(1);
  const chunk4 = (Math.floor(Math.random() * 4) + 8).toString(16) + randomHex(2).substring(1);
  const chunk5 = randomHex(6);
  return `${chunk1}-${chunk2}-${chunk3}-${chunk4}-${chunk5}`;
}

function backendHeaders(deviceId) {
  return {
    'User-Agent': USER_AGENT,
    'OAI-Client-Type': CLIENT_TYPE,
    'OAI-Device-Id': deviceId,
    'OAI-Package-Name': APP_PACKAGE,
    'X-OpenAI-No-Http-Logging': '1',
  };
}

// ইমেজ ডাইমেনশন বের করি (PNG/GIF/JPEG/WebP header parse — zero deps)
function sniffImageMime(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}

function parseImageSize(bytes) {
  // PNG: IHDR bytes 16-23 big-endian
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19], height: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23] };
  }
  // GIF: bytes 6-9 little-endian
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) };
  }
  // JPEG: scan SOF0/SOF2 markers
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      if (marker === 0xc0 || marker === 0xc2) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      i += 2 + len;
    }
  }
  // WebP (simplified)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourcc === 'VP8X' && bytes.length >= 30) {
      return { width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)), height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) };
    }
  }
  return { width: null, height: null };
}

function defaultExtensionForMime(mime) {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg':
    case 'image/jpg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
}

// STEP 1: signed Azure upload URL চাই
async function initUpload(deviceId, file_name, file_size, use_case) {
  const res = await fetch(backendUrl('files'), {
    method: 'POST',
    headers: { ...backendHeaders(deviceId), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ file_name, file_size, use_case })
  });
  if (!res.ok) throw new Error('[STEP-1 init] HTTP ' + res.status + ' ' + await res.text().catch(() => ''));
  const data = await res.json();
  if (!data.upload_url || !data.file_id) throw new Error('[STEP-1 init] missing upload_url/file_id: ' + JSON.stringify(data).slice(0, 300));
  return data;
}

// STEP 2: raw bytes PUT signed Azure URL
async function putFile(upload_url, buffer, mime) {
  const res = await fetch(upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': mime,
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2020-04-08'
    },
    body: buffer
  });
  if (!res.ok) throw new Error('[STEP-2 put] HTTP ' + res.status + ' ' + await res.text().catch(() => ''));
}

// STEP 3: process_upload_stream (anonymous এখানেই শেষ ধাপ)
async function processUpload(deviceId, file_id, use_case, file_name) {
  const res = await fetch(backendUrl('files/process_upload_stream'), {
    method: 'POST',
    headers: { ...backendHeaders(deviceId), 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ file_id, use_case, file_name, index_for_retrieval: 0 })
  });
  if (!res.ok) throw new Error('[STEP-3 process] HTTP ' + res.status + ' ' + await res.text().catch(() => ''));

  const text = await res.text();
  let completed = false;
  let errorDetail = '';
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }
    if (obj.event === 'file.processing.completed') completed = true;
    else if (obj.event === 'file.processing.error') errorDetail = 'file.processing.error: ' + (obj.message || JSON.stringify(obj).slice(0, 200));
  }
  // কিছু রেসপন্স plain text-এ "Succeeded processing" দেয় (realasfngl/ChatGPT wrapper)
  if (!completed && /Succeeded processing/i.test(text)) completed = true;
  if (errorDetail) throw new Error('[STEP-3 process] ' + errorDetail);
  if (!completed) throw new Error('[STEP-3 process] completed event not received: ' + text.slice(0, 200));
}

export default async function handler(req, res) {
  // CORS — এই API যেকোনো ডোমেইনের প্রজেক্ট থেকে call করা যাবে
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ "response": "Method not allowed" });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch (e) {
    return res.status(400).json({ "response": "Invalid JSON body" });
  }

  const message = (body.message || '').trim();
  const images = Array.isArray(body.images) ? body.images : [];

  if (!message && images.length === 0) {
    return res.status(400).json({ "response": "Message or images required" });
  }

  const deviceId = buildDeviceId();

  try {
    const assetParts = [];
    const attachments = [];
    let lastUploadError = null;

    for (const img of images) {
      if (!img || !img.base64) continue;
      const buffer = Buffer.from(img.base64, 'base64');
      if (buffer.length > 0 && buffer.length < 5 * 1024 * 1024) {
        try {
          const mime = sniffImageMime(buffer) !== 'application/octet-stream'
            ? sniffImageMime(buffer)
            : (img.mime || 'image/jpeg');
          const size = parseImageSize(buffer);
          const fileName = (img.name && /\.\w+$/.test(img.name)) ? img.name : `image.${defaultExtensionForMime(mime)}`;

          const init = await initUpload(deviceId, fileName, buffer.length, 'multimodal');
          await putFile(init.upload_url, buffer, mime);
          await processUpload(deviceId, init.file_id, 'multimodal', fileName);

          assetParts.push({
            content_type: 'image_asset_pointer',
            asset_pointer: `file-service://${init.file_id}`,
            size_bytes: buffer.length,
            width: size.width || img.width || 512,
            height: size.height || img.height || 512
          });
          attachments.push({
            id: init.file_id,
            name: fileName,
            size: buffer.length,
            mimeType: mime,
            mime_type: mime,
            width: size.width || img.width || 512,
            height: size.height || img.height || 512
          });
        } catch (uploadErr) {
          lastUploadError = uploadErr.message;
          console.error('Image upload error:', uploadErr.message);
        }
      }
    }

    if (assetParts.length === 0 && images.length > 0) {
      return res.status(500).json({ "response": "Image upload failed — OpenAI backend rejected the files. " + (lastUploadError || "Try again later.") });
    }

    // multimodal payload — text FIRST, then image pointers (verified order)
    const parts = [message].concat(assetParts);
    const msgId = buildMsgId();

    const payload = {
      action: 'next',
      messages: [{
        id: msgId,
        author: { role: 'user' },
        create_time: Date.now() / 1000,
        content: { content_type: 'multimodal_text', parts },
        status: 'finished_successfully',
        recipient: 'all',
        metadata: {
          attachments: attachments.length ? attachments : undefined,
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
          is_visually_hidden_from_conversation: false,
          exclude_after_next_user_message: false,
          content_references: [],
          search_result_groups: [],
          search_queries: [],
          image_results: [],
          real_time_audio_has_video: false,
          dictation: false,
          image_gen_async: false,
          trigger_async_ux: false,
          writing_blocks: {}
        }
      }],
      parent_message_id: 'client-created-root',
      conversationId: null,
      model: 'auto',
      history_and_training_disabled: false,
      conversation_mode: { kind: 'primary_assistant' },
      force_use_sse: true,
      force_use_search: null,
      force_paragen: false,
      supported_encodings: ['v1'],
      supports_buffering: true,
      timezone: 'UTC',
      timezone_offset_min: 0,
      noAuthAdPreferences: true,
      system_hints: [],
      enable_message_followups: true,
      stream: true
    };

    // Anonymous conversation pipeline: sentinel token -> prepare (conduit) -> f/conversation
    // (verified reference: chatgpt2api-cf, end-to-end 200)
    const sentinelRes = await fetch(backendUrl('sentinel/chat-requirements'), {
      method: 'POST',
      headers: { ...backendHeaders(deviceId), 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: '{}'
    });
    if (!sentinelRes.ok) throw new Error('[STEP-4 sentinel] HTTP ' + sentinelRes.status + ' ' + await sentinelRes.text().catch(() => ''));
    const sentinelData = await sentinelRes.json();
    const sentinelToken = sentinelData.token;
    if (!sentinelToken) throw new Error('[STEP-4 sentinel] missing token: ' + JSON.stringify(sentinelData).slice(0, 200));

    const prepareRes = await fetch(backendUrl('f/conversation/prepare'), {
      method: 'POST',
      headers: {
        ...backendHeaders(deviceId),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'openai-sentinel-chat-requirements-token': sentinelToken,
        'x-conduit-token': 'no-token'
      },
      body: JSON.stringify(payload)
    });
    if (!prepareRes.ok) throw new Error('[STEP-5 prepare] HTTP ' + prepareRes.status + ' ' + await prepareRes.text().catch(() => ''));
    const prepareData = await prepareRes.json();
    const conduitToken = prepareData.conduit_token;
    if (!conduitToken) throw new Error('[STEP-5 prepare] missing conduit_token: ' + JSON.stringify(prepareData).slice(0, 200));

    // conversation কল — backend-anon/f/conversation (anonymous namespace-এ uploaded file_id)
    const convRes = await fetch(backendUrl('f/conversation'), {
      method: 'POST',
      headers: {
        ...backendHeaders(deviceId),
        'Accept': 'text/event-stream',
        'Content-Type': 'application/json',
        'openai-sentinel-chat-requirements-token': sentinelToken,
        'x-conduit-token': conduitToken
      },
      body: JSON.stringify(payload)
    });

    const textResponse = await convRes.text();
    let text = '';
    let lastFull = ''; // cumulative snapshot tracker (backend-anon style)
    const lines = textResponse.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // "data:" prefix optional — কিছু anonymous endpoint সরাসরি JSON দেয়
      const jsonStr = line.startsWith('data:') ? line.substring(5).trim() : line;
      if (!jsonStr || jsonStr === '[DONE]') continue;

      try {
        const data = JSON.parse(jsonStr);
        if (!data || typeof data !== 'object') continue;

        // (A) backend-anon cumulative snapshot: top-level message object
        const msg = data.message;
        if (msg && typeof msg === 'object' && msg.author?.role === 'assistant') {
          if (Array.isArray(msg.content?.parts)) {
            const full = msg.content.parts.filter(p => typeof p === 'string').join('');
            if (full) {
              // cumulative snapshots — প্রতিটা event-এ পুরোটা আসে
              if (full.startsWith(lastFull) || !lastFull) {
                text = full;
              } else {
                text = full;
              }
              lastFull = full;
            }
          }
          continue;
        }

        // (B) backend-api patch style: data.v array
        if (data.v && Array.isArray(data.v)) {
          const patches = data.v;
          for (let j = 0; j < patches.length; j++) {
            const patch = patches[j] || {};
            if (patch.p === '/message/content/parts/0' && patch.o === 'append' && typeof patch.v === 'string') {
              text += patch.v;
            }
          }
        }

        // (C) top-level append patch: {"o":"append","p":...,"v":"..."}
        if (data.o === 'append' && data.p === '/message/content/parts/0' && typeof data.v === 'string') {
          text += data.v;
        }

        // (D) data.v?.message snapshot (কিছু ক্লায়েন্টে message ভিতরে থাকে)
        const innerMsg = data.v && typeof data.v === 'object' ? data.v.message : null;
        if (innerMsg && innerMsg.author?.role === 'assistant' && Array.isArray(innerMsg.content?.parts)) {
          const full = innerMsg.content.parts.filter(p => typeof p === 'string').join('');
          if (full) {
            if (full.startsWith(lastFull) || !lastFull) {
              text = full;
            } else {
              text = full;
            }
            lastFull = full;
          }
        }
      } catch (e) {
        // Partial chunk JSON parse error ignore করা হলো
      }
    }

    // status 200 কিন্তু কিছু পাওয়া যায়নি — diagnostic সহ error
    if (!text && convRes.status === 200) {
      text = 'Error: OpenAI backend returned an empty response (stream parsing failed). Raw: ' + textResponse.slice(0, 200).replace(/\n/g, ' ');
    } else if (!text && convRes.status !== 200) {
      text = `Error ${convRes.status}: API request blocked by Cloudflare/OpenAI from Vercel IP.`;
    }

    res.status(200).json({
      "Owner -> ": "@black_fox_teach",
      "message": message,
      "response": text.trim()
    });

  } catch (error) {
    res.status(500).json({ "response": "Backend Connection Error: " + error.message });
  }
}
