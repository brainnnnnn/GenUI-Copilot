import { WIDGET_SYSTEM_PROMPT, RENDER_WIDGET_TOOL } from '@/lib/widget-guidelines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enc = new TextEncoder();

function ndjson(obj: object) {
  return enc.encode(JSON.stringify(obj) + '\n');
}

// Extract partial widget_code value from incomplete JSON string
function extractPartialCode(partialJson: string): string | null {
  const keyIdx = partialJson.indexOf('"widget_code"');
  if (keyIdx === -1) return null;
  const colonIdx = partialJson.indexOf(':', keyIdx + 13);
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < partialJson.length && partialJson[i] === ' ') i++;
  if (i >= partialJson.length || partialJson[i] !== '"') return null;
  i++; // skip opening quote

  // Scan forward respecting escape sequences — stop at closing quote or end of string
  let raw = '';
  while (i < partialJson.length) {
    const ch = partialJson[i];
    if (ch === '\\' && i + 1 < partialJson.length) {
      raw += ch + partialJson[i + 1];
      i += 2;
    } else if (ch === '"') {
      break; // closing quote found
    } else {
      raw += ch;
      i++;
    }
  }
  // If we consumed a trailing lone backslash, drop it
  if (raw.endsWith('\\')) raw = raw.slice(0, -1);

  try {
    return raw
      .replace(/\\\\/g, '\x00BSLASH\x00')
      .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\x00BSLASH\x00/g, '\\');
  } catch { return null; }
}

type Controller = ReadableStreamDefaultController<Uint8Array>;

// ── OpenAI-compatible SSE parser ────────────────────────────────────────────

interface ToolCallState {
  id: string;
  name: string;
  args: string; // accumulated JSON string
  emittedStart: boolean;
  prevCode: string;
}

async function streamOpenAI(
  res: Response,
  ctrl: Controller,
): Promise<{ toolCall: ToolCallState | null; assistantText: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let assistantText = '';
  const toolCallMap: Record<number, ToolCallState> = {};
  let widgetId = 0;
  let toolCallActive = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json: Record<string, unknown>;
      try { json = JSON.parse(data); } catch { continue; }

      const choice = (json.choices as Array<Record<string, unknown>>)?.[0];
      if (!choice) continue;
      const delta = (choice.delta ?? {}) as Record<string, unknown>;

      // Tool calls — check first so we can suppress text once a tool starts
      const tcs = delta.tool_calls as Array<Record<string, unknown>> | undefined;
      if (tcs && tcs.length > 0) toolCallActive = true;

      // Text — suppress once a tool call starts (some models emit content alongside tool_calls)
      if (typeof delta.content === 'string' && delta.content && !toolCallActive) {
        assistantText += delta.content;
        ctrl.enqueue(ndjson({ t: 'tx', v: delta.content }));
      }

      if (tcs) {
        for (const tc of tcs) {
          const idx = tc.index as number;
          if (!toolCallMap[idx]) {
            toolCallMap[idx] = { id: String(tc.id ?? ''), name: '', args: '', emittedStart: false, prevCode: '' };
          }
          if (tc.id) toolCallMap[idx].id = String(tc.id);
          const fn = (tc.function ?? {}) as Record<string, string>;
          if (fn.name) toolCallMap[idx].name = fn.name;
          if (fn.arguments) {
            toolCallMap[idx].args += fn.arguments;
            const state = toolCallMap[idx];

            if (state.name === 'render_widget') {
              if (!state.emittedStart) {
                state.emittedStart = true;
                ctrl.enqueue(ndjson({ t: 'ws', id: String(widgetId) }));
              }
              const code = extractPartialCode(state.args);
              if (code && code !== state.prevCode) {
                ctrl.enqueue(ndjson({ t: 'wd', id: String(widgetId), v: code }));
                state.prevCode = code;
              }
            }
          }
        }
      }
    }
  }

  // Finalize widget
  const tc = Object.values(toolCallMap).find(t => t.name === 'render_widget') ?? null;
  if (tc) {
    try {
      const parsed = JSON.parse(tc.args);
      ctrl.enqueue(ndjson({ t: 'we', id: String(widgetId), title: parsed.title ?? '', code: parsed.widget_code ?? tc.prevCode }));
    } catch {
      ctrl.enqueue(ndjson({ t: 'we', id: String(widgetId), title: '', code: tc.prevCode }));
    }
    return { toolCall: tc, assistantText };
  }

  return { toolCall: null, assistantText };
}

// ── Anthropic direct SSE parser ─────────────────────────────────────────────

async function streamAnthropic(
  res: Response,
  ctrl: Controller,
): Promise<{ toolCall: { id: string; name: string; args: string } | null; assistantText: string; assistantBlocks: unknown[] }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let assistantText = '';
  const assistantBlocks: unknown[] = [];

  // track per content-block-index
  const blocks: Record<number, { type: string; id?: string; name?: string; args: string; text: string }> = {};
  let widgetId = 0;
  let widgetBlockIdx = -1;
  let prevCode = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      let json: Record<string, unknown>;
      try { json = JSON.parse(line.slice(5).trim()); } catch { continue; }

      if (json.type === 'content_block_start') {
        const idx = json.index as number;
        const cb = json.content_block as Record<string, unknown>;
        blocks[idx] = { type: String(cb.type), id: cb.id as string, name: cb.name as string, args: '', text: String(cb.text ?? '') };
        if (cb.type === 'tool_use' && cb.name === 'render_widget') {
          widgetBlockIdx = idx;
          ctrl.enqueue(ndjson({ t: 'ws', id: String(widgetId) }));
          prevCode = '';
        }
      }

      if (json.type === 'content_block_delta') {
        const idx = json.index as number;
        const delta = json.delta as Record<string, unknown>;
        if (!blocks[idx]) continue;

        if (delta.type === 'text_delta') {
          const text = String(delta.text ?? '');
          assistantText += text;
          blocks[idx].text += text;
          ctrl.enqueue(ndjson({ t: 'tx', v: text }));
        }

        if (delta.type === 'input_json_delta') {
          const partial = String(delta.partial_json ?? '');
          blocks[idx].args += partial;
          if (idx === widgetBlockIdx) {
            const code = extractPartialCode(blocks[idx].args);
            if (code && code !== prevCode) {
              ctrl.enqueue(ndjson({ t: 'wd', id: String(widgetId), v: code }));
              prevCode = code;
            }
          }
        }
      }

      if (json.type === 'content_block_stop') {
        const idx = json.index as number;
        const b = blocks[idx];
        if (!b) continue;
        if (b.type === 'text' && b.text) assistantBlocks.push({ type: 'text', text: b.text });
        if (b.type === 'tool_use') {
          try {
            const parsed = JSON.parse(b.args);
            assistantBlocks.push({ type: 'tool_use', id: b.id, name: b.name, input: parsed });
            if (idx === widgetBlockIdx) {
              ctrl.enqueue(ndjson({ t: 'we', id: String(widgetId), title: parsed.title ?? '', code: parsed.widget_code ?? prevCode }));
            }
          } catch {
            assistantBlocks.push({ type: 'tool_use', id: b.id, name: b.name, input: {} });
            if (idx === widgetBlockIdx) {
              ctrl.enqueue(ndjson({ t: 'we', id: String(widgetId), title: '', code: prevCode }));
            }
          }
        }
      }
    }
  }

  const toolBlock = assistantBlocks.find(b => (b as Record<string, unknown>).type === 'tool_use') as
    | { type: string; id: string; name: string; input: Record<string, unknown> } | undefined;

  return {
    toolCall: toolBlock ? { id: toolBlock.id, name: toolBlock.name, args: JSON.stringify(toolBlock.input) } : null,
    assistantText,
    assistantBlocks,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { messages, model, apiKey, baseURL } = await req.json() as {
    messages: Array<{ role: string; content: string }>;
    model: string;
    apiKey: string;
    baseURL?: string;
  };

  if (!apiKey) {
    return new Response('Missing API key', { status: 400 });
  }

  const isAnthropic = !baseURL && apiKey.startsWith('sk-ant-');
  const isGoogle = !baseURL && apiKey.startsWith('AIza');

  // Google: use OpenAI-compatible endpoint
  if (isGoogle) {
    const googleBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
    const googleModel = (model as string).replace(/^google\//, '') || 'gemini-2.0-flash';
    const readable = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        try { await runOpenAI(googleBase, apiKey, googleModel, messages, ctrl); }
        catch (err) { ctrl.enqueue(ndjson({ t: 'err', v: err instanceof Error ? err.message : String(err) })); }
        finally { ctrl.close(); }
      },
    });
    return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      try {
        if (isAnthropic) {
          await runAnthropic(apiKey, model, messages, ctrl);
        } else {
          await runOpenAI(baseURL, apiKey, model, messages, ctrl);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[chat] error:', msg);
        ctrl.enqueue(ndjson({ t: 'err', v: msg }));
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
}

// ── OpenAI-compatible runner ─────────────────────────────────────────────────

async function runOpenAI(
  baseURL: string | undefined,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  ctrl: Controller,
) {
  const url = (baseURL?.replace(/\/$/, '') ?? 'https://openrouter.ai/api/v1') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };

  const body1 = JSON.stringify({
    model: model || 'moonshot-v1-8k',
    messages: [{ role: 'system', content: WIDGET_SYSTEM_PROMPT }, ...messages],
    tools: [RENDER_WIDGET_TOOL],
    tool_choice: 'auto',
    stream: true,
  });

  const res1 = await fetch(url, { method: 'POST', headers, body: body1 });
  if (!res1.ok) {
    const err = await res1.text();
    throw new Error(`API error ${res1.status}: ${err}`);
  }

  const { toolCall, assistantText } = await streamOpenAI(res1, ctrl);

  if (!toolCall) return;

  // Second turn: send tool result, get continuation text
  const body2 = JSON.stringify({
    model: model || 'moonshot-v1-8k',
    messages: [
      { role: 'system', content: WIDGET_SYSTEM_PROMPT },
      ...messages,
      {
        role: 'assistant',
        content: assistantText || null,
        tool_calls: [{
          id: toolCall.id || 'call_0',
          type: 'function',
          function: { name: toolCall.name, arguments: toolCall.args },
        }],
      },
      { role: 'tool', tool_call_id: toolCall.id || 'call_0', content: 'Widget rendered successfully.' },
    ],
    tools: [RENDER_WIDGET_TOOL],
    tool_choice: 'auto',
    stream: true,
  });

  const res2 = await fetch(url, { method: 'POST', headers, body: body2 });
  if (res2.ok) await streamOpenAI(res2, ctrl);
}

// ── Anthropic runner ─────────────────────────────────────────────────────────

async function runAnthropic(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  ctrl: Controller,
) {
  const url = 'https://api.anthropic.com/v1/messages';
  const id = model.replace(/^anthropic\//, '') || 'claude-sonnet-4-5';
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  const anthropicTool = {
    name: RENDER_WIDGET_TOOL.function.name,
    description: RENDER_WIDGET_TOOL.function.description,
    input_schema: RENDER_WIDGET_TOOL.function.parameters,
  };

  const body1 = JSON.stringify({
    model: id,
    max_tokens: 4096,
    system: WIDGET_SYSTEM_PROMPT,
    messages,
    tools: [anthropicTool],
    tool_choice: { type: 'auto' },
    stream: true,
  });

  const res1 = await fetch(url, { method: 'POST', headers, body: body1 });
  if (!res1.ok) {
    const err = await res1.text();
    throw new Error(`Anthropic error ${res1.status}: ${err}`);
  }

  const { toolCall, assistantBlocks } = await streamAnthropic(res1, ctrl);

  if (!toolCall) return;

  const body2 = JSON.stringify({
    model: id,
    max_tokens: 4096,
    system: WIDGET_SYSTEM_PROMPT,
    messages: [
      ...messages,
      { role: 'assistant', content: assistantBlocks },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolCall.id, content: 'Widget rendered successfully.' }],
      },
    ],
    tools: [anthropicTool],
    tool_choice: { type: 'auto' },
    stream: true,
  });

  const res2 = await fetch(url, { method: 'POST', headers, body: body2 });
  if (res2.ok) await streamAnthropic(res2, ctrl);
}
