'use client';

import { useRef, useEffect, useState } from 'react';
import { MessageItem } from './MessageItem';
import { useStreamingChat } from '@/hooks/useStreamingChat';

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';

const POPULAR_MODELS = [
  { value: 'anthropic/claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-opus-4', label: 'Claude Opus 4' },
  { value: 'google/gemini-2.5-flash-preview', label: 'Gemini 2.5 Flash' },
  { value: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3' },
  { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
];

export function ChatInterface() {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [isDark, setIsDark] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeModel = customModel.trim() || model;
  const { messages, isLoading, error, sendMessage, stop } = useStreamingChat('/api/chat');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const saved = localStorage.getItem('genui-api-key');
    if (saved) setApiKey(saved);
    const savedBase = localStorage.getItem('genui-base-url');
    if (savedBase) setBaseURL(savedBase);
    const savedModel = localStorage.getItem('genui-model');
    if (savedModel) setModel(savedModel);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDark(prefersDark);
    if (prefersDark) document.documentElement.classList.add('dark');
  }, []);

  function toggleTheme() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
  }

  function saveApiKey(val: string) {
    setApiKey(val);
    localStorage.setItem('genui-api-key', val);
  }

  function saveBaseURL(val: string) {
    setBaseURL(val);
    localStorage.setItem('genui-base-url', val);
  }

  function saveModel(val: string) {
    setModel(val);
    localStorage.setItem('genui-model', val);
  }

  function submit() {
    if (!input.trim() || !apiKey || isLoading) return;
    const text = input;
    setInput('');
    sendMessage(text, { apiKey, model: activeModel, baseURL: baseURL.trim() || undefined });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const canSend = !isLoading && !!apiKey && !!input.trim();

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">AI 家教</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">
            全科
          </span>
        </div>
        <button
          onClick={toggleTheme}
          className="text-xs px-2.5 py-1 rounded-md border border-border/50 hover:bg-muted/50 transition-colors text-muted-foreground"
        >
          {isDark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>

      {/* Config bar */}
      <div className="flex flex-col gap-1.5 px-4 py-2 border-b border-border/30 bg-muted/20 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="password"
            placeholder="API Key — sk-ant-… (Anthropic) / AIza… (Google) / sk-or-… (OpenRouter) / sk-… (OpenAI)"
            value={apiKey}
            onChange={e => saveApiKey(e.target.value)}
            className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
          />
          <input
            type="text"
            placeholder="Base URL (可选，如 https://api.moonshot.cn/v1)"
            value={baseURL}
            onChange={e => saveBaseURL(e.target.value)}
            className="w-72 text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={model}
            onChange={e => saveModel(e.target.value)}
            className="text-xs px-2 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
          >
            {POPULAR_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="或直接填 model id，如 moonshot-v1-8k"
            value={customModel}
            onChange={e => setCustomModel(e.target.value)}
            className="flex-1 min-w-0 text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-muted-foreground">
            <p className="text-sm font-medium">问任何学科的问题，复杂概念会配上交互图解</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {[
                '用动画解释梯度下降',
                '傅里叶变换是什么，可视化一下',
                '帮我理解贝叶斯定理',
                '牛顿第二定律，让我调参数感受一下',
              ].map(ex => (
                <button
                  key={ex}
                  className="text-xs px-3 py-1.5 rounded-full border border-border/50 hover:bg-muted/40 transition-colors"
                  onClick={() => {
                    setInput(ex);
                    inputRef.current?.focus();
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1;
          return (
            <MessageItem
              key={msg.id}
              role={msg.role}
              content={msg.content}
              segments={msg.segments}
              isStreaming={isLastAssistant && isLoading}
            />
          );
        })}

        {error && (
          <div className="text-xs text-destructive px-3 py-2 rounded bg-destructive/10 border border-destructive/20 mb-4">
            {error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 px-4 py-3 border-t border-border/50">
        <form
          onSubmit={e => {
            e.preventDefault();
            if (canSend) submit();
          }}
          className="flex items-end gap-2"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={apiKey ? '问任何问题…（Enter 发送，Shift+Enter 换行）' : '先填入 API Key 才能开始'}
            disabled={!apiKey || isLoading}
            rows={1}
            className="flex-1 resize-none text-sm px-3 py-2.5 rounded-xl border border-border/50 bg-background focus:outline-none focus:border-border/80 disabled:opacity-50 min-h-[42px] max-h-48 overflow-y-auto"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <button
            type={isLoading ? 'button' : 'submit'}
            onClick={isLoading ? stop : undefined}
            disabled={!isLoading && !canSend}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
          >
            {isLoading ? 'Stop' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}
