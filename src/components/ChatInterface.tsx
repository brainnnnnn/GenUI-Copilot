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

function modelLabel(value: string): string {
  return POPULAR_MODELS.find(m => m.value === value)?.label ?? value;
}

export function ChatInterface() {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [customModel, setCustomModel] = useState('');
  const [isDark, setIsDark] = useState(false);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const activeModel = customModel.trim() || model;
  const { messages, isLoading, error, sendMessage, stop } = useStreamingChat('/api/chat');

  // Close popover on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    if (settingsOpen) document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [settingsOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const saved = sessionStorage.getItem('genui-api-key');
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
    sessionStorage.setItem('genui-api-key', val);
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
  const displayLabel = customModel.trim() ? customModel.trim() : modelLabel(model);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="relative flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
        {/* Left: brand */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">AI 家教</span>
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted/60">
            全科
          </span>
        </div>

        {/* Center: model / settings trigger */}
        <div ref={settingsRef} className="absolute left-1/2 -translate-x-1/2">
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-border/50 hover:bg-muted/50 transition-colors text-muted-foreground"
          >
            {!apiKey && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            )}
            <span className="max-w-[180px] truncate">
              {apiKey ? displayLabel : '设置 API Key'}
            </span>
            <span className="opacity-50 text-[10px]">⚙</span>
          </button>

          {/* Settings popover */}
          {settingsOpen && (
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-80 bg-background border border-border/50 rounded-xl shadow-lg z-50 p-4 flex flex-col gap-3">
              {/* Popover header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">API 设置</span>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors leading-none"
                >
                  ✕
                </button>
              </div>

              {/* API Key */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">API Key</label>
                <input
                  type="password"
                  placeholder="sk-ant-… / AIza… / sk-or-… / sk-…"
                  value={apiKey}
                  onChange={e => saveApiKey(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
                />
              </div>

              {/* Base URL */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  Base URL
                  <span className="opacity-50 ml-1">（可选）</span>
                </label>
                <input
                  type="text"
                  placeholder="https://api.moonshot.cn/v1"
                  value={baseURL}
                  onChange={e => saveBaseURL(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
                />
              </div>

              {/* Model selector */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">模型</label>
                <select
                  value={model}
                  onChange={e => saveModel(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
                >
                  {POPULAR_MODELS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Custom model ID */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">
                  自定义 Model ID
                  <span className="opacity-50 ml-1">（可选，优先于下拉）</span>
                </label>
                <input
                  type="text"
                  placeholder="moonshot-v1-8k"
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-border/50 bg-background focus:outline-none focus:border-border"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="text-xs px-2.5 py-1 rounded-md border border-border/50 hover:bg-muted/50 transition-colors text-muted-foreground"
        >
          {isDark ? '☀ Light' : '☾ Dark'}
        </button>
      </header>

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
