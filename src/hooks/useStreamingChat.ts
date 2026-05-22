'use client';

import { useState, useCallback, useRef } from 'react';

export interface TextSegment {
  type: 'text';
  content: string;
  key: string;
}

export interface WidgetSegment {
  type: 'widget';
  title: string;
  code: string;
  isStreaming: boolean;
  key: string;
}

export type MessageSegment = TextSegment | WidgetSegment;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  // user messages use content; assistant messages use segments
  content: string;
  segments: MessageSegment[];
}

export function useStreamingChat(apiPath = '/api/chat') {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (
    userContent: string,
    config: { apiKey: string; model: string; baseURL?: string },
  ) => {
    if (!userContent.trim()) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userContent,
      segments: [],
    };

    const assistantId = `a-${Date.now()}`;
    const nextMessages = [...messages, userMsg];

    setMessages([...nextMessages, {
      id: assistantId, role: 'assistant', content: '', segments: [],
    }]);
    setIsLoading(true);
    setError(null);

    abortRef.current = new AbortController();

    // Local accumulator — mutate in place, spread to trigger re-render
    const segs: MessageSegment[] = [];
    let widgetCount = 0;

    function applyEvent(event: Record<string, unknown>) {
      switch (event.t) {
        case 'tx': {
          const v = String(event.v ?? '');
          if (!v) break;
          const last = segs[segs.length - 1];
          if (last?.type === 'text') {
            last.content += v;
          } else {
            segs.push({ type: 'text', content: v, key: `t-${segs.length}` });
          }
          break;
        }
        case 'ws': {
          segs.push({ type: 'widget', title: '', code: '', isStreaming: true, key: `w-${widgetCount}` });
          break;
        }
        case 'wd': {
          const w = segs.findLast(s => s.type === 'widget') as WidgetSegment | undefined;
          if (w) w.code = String(event.v ?? '');
          break;
        }
        case 'we': {
          const w = segs.findLast(s => s.type === 'widget') as WidgetSegment | undefined;
          if (w) {
            w.code = String(event.code ?? w.code);
            w.title = String(event.title ?? w.title);
            w.isStreaming = false;
            widgetCount++;
          }
          break;
        }
        case 'err': {
          throw new Error(String(event.v ?? 'Unknown error'));
        }
      }

      // Snapshot: new array + shallow-clone each segment to trigger re-render
      const snapshot = segs.map(s => ({ ...s }));
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, segments: snapshot } : m)
      );
    }

    try {
      const res = await fetch(apiPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify({
          messages: nextMessages.map(m => ({
            role: m.role,
            content: m.role === 'assistant'
              ? m.segments.filter(s => s.type === 'text').map(s => (s as TextSegment).content).join('')
              : m.content,
          })),
          model: config.model,
          apiKey: config.apiKey,
          ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text() || `API error ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            applyEvent(JSON.parse(line) as Record<string, unknown>);
          } catch (e) {
            if (e instanceof Error) throw e;
          }
        }
      }

      // Flush remaining buffer
      if (buf.trim()) {
        try { applyEvent(JSON.parse(buf) as Record<string, unknown>); } catch { /* ignore */ }
      }

      if (segs.length === 0) {
        throw new Error('No response received — check your API key and model access.');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err as Error);
        setMessages(prev => prev.filter(m => m.id !== assistantId));
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, apiPath]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isLoading, error, sendMessage, stop };
}
