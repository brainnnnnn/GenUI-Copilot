'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { WidgetRenderer } from './WidgetRenderer';
import type { MessageSegment } from '@/hooks/useStreamingChat';

interface MessageItemProps {
  role: 'user' | 'assistant';
  content: string;
  segments: MessageSegment[];
  isStreaming?: boolean;
}

export function MessageItem({ role, content, segments, isStreaming = false }: MessageItemProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-primary text-primary-foreground text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  const hasContent = segments.some(s => s.type === 'text' ? s.content.trim() : s.code.trim());

  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[90%] w-full">
        {/* Pulsing cursor while waiting for first content */}
        {!hasContent && isStreaming && (
          <span className="inline-block w-1.5 h-4 bg-foreground/50 animate-pulse rounded-sm" />
        )}

        {segments.map((seg, i) =>
          seg.type === 'text' ? (
            <div key={i} className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{seg.content}</ReactMarkdown>
            </div>
          ) : (
            <WidgetRenderer
              key={seg.key}
              widgetCode={seg.code}
              isStreaming={seg.isStreaming}
              title={seg.title}
              showOverlay={false}
            />
          )
        )}

        {/* Trailing cursor after text while streaming */}
        {isStreaming && segments.length > 0 && segments[segments.length - 1].type === 'text' && (
          <span className="inline-block w-1.5 h-3.5 bg-foreground/40 animate-pulse rounded-sm align-middle ml-0.5" />
        )}
      </div>
    </div>
  );
}
