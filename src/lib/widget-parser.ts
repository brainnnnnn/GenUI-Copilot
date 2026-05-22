/**
 * show-widget fence parser for streaming + finalized text.
 *
 * Extracted from CodePilot's MessageItem.tsx / StreamingMessage.tsx.
 * Returns an array of alternating text/widget segments for rendering.
 */

export interface TextSegment {
  type: 'text';
  content: string;
}

export interface WidgetSegment {
  type: 'widget';
  title?: string;
  code: string;
  /** Still being generated — use streaming update path in WidgetRenderer */
  isStreaming: boolean;
  /** Unclosed <script> was truncated — show overlay while scripts stream */
  showOverlay: boolean;
  /** Stable React key that persists across streaming→finalized transition */
  key: string;
}

export type Segment = TextSegment | WidgetSegment;

// ── helpers ────────────────────────────────────────────────────────────────

/** Find the index of the closing `}` for the JSON object starting at `start`. */
function findJsonEnd(text: string, start: number): number {
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Manually unescape a partial JSON string value (JSON.parse can't handle incomplete JSON). */
function unescapePartial(raw: string): string {
  return raw
    .replace(/\\\\/g, '\x00BS\x00')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\x00BS\x00/g, '\\');
}

/** Extract widget_code from a truncated/incomplete JSON fence body. */
function extractPartialWidgetCode(fenceBody: string): { code: string | null; title?: string; scriptsTruncated: boolean } {
  let code: string | null = null;
  let scriptsTruncated = false;

  // Try full JSON parse first (fence may actually be complete)
  try {
    const json = JSON.parse(fenceBody);
    if (json.widget_code) return { code: String(json.widget_code), title: json.title, scriptsTruncated: false };
  } catch { /* expected — JSON is truncated */ }

  // String-search extraction of widget_code value
  const keyIdx = fenceBody.indexOf('"widget_code"');
  if (keyIdx !== -1) {
    const colonIdx = fenceBody.indexOf(':', keyIdx + 13);
    if (colonIdx !== -1) {
      const quoteIdx = fenceBody.indexOf('"', colonIdx + 1);
      if (quoteIdx !== -1) {
        let raw = fenceBody.slice(quoteIdx + 1);
        // Strip trailing close: `" }` or `"}` that terminates the JSON string
        raw = raw.replace(/"\s*\}\s*$/, '');
        // Strip trailing lone backslash (incomplete escape)
        if (raw.endsWith('\\')) raw = raw.slice(0, -1);
        try {
          code = unescapePartial(raw);
        } catch {
          code = null;
        }
      }
    }
  }

  // Truncate at unclosed <script> — prevents JS code showing as visible text
  if (code) {
    const lastScript = code.lastIndexOf('<script');
    if (lastScript !== -1) {
      const afterScript = code.slice(lastScript);
      if (!/<script[\s\S]*?<\/script>/i.test(afterScript)) {
        code = code.slice(0, lastScript).trim() || null;
        scriptsTruncated = true;
      }
    }
  }

  // Extract title
  const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/);
  const title = titleMatch ? titleMatch[1] : undefined;

  return { code, title, scriptsTruncated };
}

/** Parse all completed show-widget fences in text. */
function parseAllShowWidgets(text: string): Array<{ type: 'text'; content: string } | { type: 'widget'; title?: string; code: string }> {
  const segments: Array<{ type: 'text'; content: string } | { type: 'widget'; title?: string; code: string }> = [];
  const markerRegex = /`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/g;
  let lastIndex = 0;
  let foundAny = false;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(text)) !== null) {
    const afterMarker = match.index + match[0].length;
    const jsonStart = text.indexOf('{', afterMarker);
    if (jsonStart === -1 || jsonStart > afterMarker + 20) {
      const fenceClose = text.indexOf('```', afterMarker);
      if (fenceClose !== -1 && fenceClose < afterMarker + 200) {
        lastIndex = fenceClose + 3;
        markerRegex.lastIndex = fenceClose + 3;
        foundAny = true;
      }
      continue;
    }

    const jsonEnd = findJsonEnd(text, jsonStart);
    if (jsonEnd === -1) {
      // Truncated JSON — try partial extraction
      const { code, title } = extractPartialWidgetCode(text.slice(jsonStart));
      if (code) {
        foundAny = true;
        const before = text.slice(lastIndex, match.index).trim();
        if (before) segments.push({ type: 'text', content: before });
        segments.push({ type: 'widget', code, title });
        lastIndex = text.length;
      }
      break;
    }

    const jsonStr = text.slice(jsonStart, jsonEnd + 1);
    try {
      const json = JSON.parse(jsonStr);
      if (json.widget_code) {
        foundAny = true;
        const before = text.slice(lastIndex, match.index).trim();
        if (before) segments.push({ type: 'text', content: before });
        segments.push({ type: 'widget', code: String(json.widget_code), title: json.title || undefined });
        let endPos = jsonEnd + 1;
        const trailingFence = text.slice(endPos, endPos + 10).match(/^\s*\n?`{1,3}\s*/);
        if (trailingFence) endPos += trailingFence[0].length;
        lastIndex = endPos;
        markerRegex.lastIndex = endPos;
      }
    } catch {
      const fenceClose = text.indexOf('```', jsonStart);
      if (fenceClose !== -1) {
        markerRegex.lastIndex = fenceClose + 3;
        lastIndex = fenceClose + 3;
        foundAny = true;
      }
    }
  }

  if (!foundAny) return [];
  const remaining = text.slice(lastIndex).trim();
  if (remaining) segments.push({ type: 'text', content: remaining });
  return segments;
}

/**
 * Compute a stable React key for the in-progress partial widget.
 * Must match the `w-N` key it will get once the fence closes.
 */
function computePartialWidgetKey(content: string): string {
  const markers = [...content.matchAll(/`{1,3}show-widget/g)];
  if (markers.length === 0) return 'w-0';
  const lastMarker = markers[markers.length - 1];
  const beforePart = content.slice(0, lastMarker.index).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedSegments = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];
  const widgetCount = completedSegments.filter(s => s.type === 'widget').length;
  return `w-${hasCompletedFences ? widgetCount : (beforePart ? 1 : 0)}`;
}

// ── main export ────────────────────────────────────────────────────────────

/**
 * Parse accumulated streaming or finalized text into renderable segments.
 *
 * @param text       Accumulated message text (may be partial during streaming)
 * @param isStreaming Whether the message is still being received
 */
export function parseWidgetSegments(text: string, isStreaming: boolean): Segment[] {
  const hasWidgetFence = /`{1,3}show-widget/.test(text);

  if (!hasWidgetFence) {
    return text ? [{ type: 'text', content: text }] : [];
  }

  if (!isStreaming) {
    // All fences complete — full parse
    const raw = parseAllShowWidgets(text);
    if (raw.length === 0) return [{ type: 'text', content: text }];
    let widgetIdx = 0;
    return raw.map(seg =>
      seg.type === 'text'
        ? { type: 'text' as const, content: seg.content }
        : { type: 'widget' as const, code: seg.code, title: seg.title, isStreaming: false, showOverlay: false, key: `w-${widgetIdx++}` }
    );
  }

  // Streaming: find the last open fence
  const lastMarkerMatch = [...text.matchAll(/`{1,3}show-widget/g)].pop();
  if (!lastMarkerMatch) return [{ type: 'text', content: text }];

  const lastFenceStart = lastMarkerMatch.index!;
  const afterLastFence = text.slice(lastFenceStart);

  // Check if the last fence JSON is complete
  const jsonStart = afterLastFence.indexOf('{');
  let lastFenceClosed = false;
  if (jsonStart !== -1) {
    let depth = 0, inStr = false, esc = false;
    for (let i = jsonStart; i < afterLastFence.length; i++) {
      const ch = afterLastFence[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { lastFenceClosed = true; break; } }
    }
  }

  if (lastFenceClosed) {
    // All fences are complete even during streaming
    const raw = parseAllShowWidgets(text);
    if (raw.length === 0) return [{ type: 'text', content: text }];
    let widgetIdx = 0;
    return raw.map(seg =>
      seg.type === 'text'
        ? { type: 'text' as const, content: seg.content }
        : { type: 'widget' as const, code: seg.code, title: seg.title, isStreaming: false, showOverlay: false, key: `w-${widgetIdx++}` }
    );
  }

  // Last fence is still open — render completed parts + partial streaming widget
  const beforePart = text.slice(0, lastFenceStart).trim();
  const hasCompletedFences = beforePart.length > 0 && /`{1,3}show-widget/.test(beforePart);
  const completedRaw = hasCompletedFences ? parseAllShowWidgets(beforePart) : [];

  // Extract partial widget_code from the open fence
  const markerEnd = afterLastFence.match(/^`{1,3}show-widget`{0,3}\s*(?:\n\s*`{3}(?:json)?\s*)?\n?/);
  const fenceBody = markerEnd ? afterLastFence.slice(markerEnd[0].length).trim() : afterLastFence.trim();
  const { code: partialCode, title: partialTitle, scriptsTruncated } = extractPartialWidgetCode(fenceBody);

  const partialKey = computePartialWidgetKey(text);

  const result: Segment[] = [];

  // Text before completed fences (only when no completed fences yet)
  if (!hasCompletedFences && beforePart) {
    result.push({ type: 'text', content: beforePart });
  }

  // Completed fences + interleaved text
  let widgetIdx = 0;
  for (const seg of completedRaw) {
    if (seg.type === 'text') {
      result.push({ type: 'text', content: seg.content });
    } else {
      result.push({ type: 'widget', code: seg.code, title: seg.title, isStreaming: false, showOverlay: false, key: `w-${widgetIdx++}` });
    }
  }

  // Partial streaming widget
  if (partialCode && partialCode.length > 10) {
    result.push({ type: 'widget', code: partialCode, title: partialTitle, isStreaming: true, showOverlay: scriptsTruncated, key: partialKey });
  }

  return result;
}
