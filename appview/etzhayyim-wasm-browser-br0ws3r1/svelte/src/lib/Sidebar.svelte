<script lang="ts">
  import type { SparkSection, SearchEvent } from './types.js';

  let {
    open,
    width,
    pageUrl,
    onToggle
  }: {
    open: boolean;
    width: number;
    pageUrl: string;
    onToggle: () => void;
  } = $props();

  let query = $state('');
  let loading = $state(false);
  let sections = $state<SparkSection[]>([]);
  let sources = $state<string[]>([]);
  let phase = $state<'idle' | 'planning' | 'searching' | 'scraping' | 'synthesizing' | 'done'>('idle');
  let error = $state('');

  async function runSearch() {
    if (!query.trim() || loading) return;
    loading = true;
    sections = [];
    sources = [];
    error = '';
    phase = 'planning';

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), page_url: pageUrl })
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') { phase = 'done'; break; }
          try {
            const ev: SearchEvent = JSON.parse(raw);
            handleEvent(ev);
          } catch { /* ignore malformed */ }
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
      if (phase !== 'done') phase = 'idle';
    }
  }

  function handleEvent(ev: SearchEvent) {
    switch (ev.type) {
      case 'phase':
        phase = ev.phase as typeof phase;
        break;
      case 'source':
        if (!sources.includes(ev.url)) sources = [...sources, ev.url];
        break;
      case 'section':
        sections = [...sections, { title: ev.title, content: '' }];
        break;
      case 'token': {
        if (sections.length === 0) sections = [{ title: 'Summary', content: '' }];
        const last = sections[sections.length - 1];
        sections = [...sections.slice(0, -1), { ...last, content: last.content + ev.token }];
        break;
      }
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch(); }
  }

  const phaseLabel: Record<string, string> = {
    planning: 'Planning queries…',
    searching: 'Searching the web…',
    scraping: 'Reading pages…',
    synthesizing: 'Synthesizing…',
    done: 'Done'
  };
</script>

<div class="sidebar" class:open style="width: {width}px">
  <div class="header">
    <span class="logo">AI Browser</span>
    <button class="toggle" onclick={onToggle} title="Close sidebar">✕</button>
  </div>

  <div class="search-area">
    <textarea
      class="query-input"
      bind:value={query}
      onkeydown={onKeydown}
      placeholder="Ask anything or search the web…"
      rows={2}
      disabled={loading}
    ></textarea>
    <button class="search-btn" onclick={runSearch} disabled={loading || !query.trim()}>
      {loading ? '…' : 'Search'}
    </button>
  </div>

  {#if phase !== 'idle' && phase !== 'done'}
    <div class="phase-indicator">
      <span class="pulse"></span>
      {phaseLabel[phase] ?? phase}
    </div>
  {/if}

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="results">
    {#each sections as sec}
      <div class="section">
        {#if sec.title}
          <h3 class="section-title">{sec.title}</h3>
        {/if}
        <p class="section-body">{sec.content}</p>
      </div>
    {/each}
  </div>

  {#if sources.length > 0}
    <div class="sources">
      <div class="sources-label">Sources ({sources.length})</div>
      {#each sources as src}
        <a class="source-link" href={src} target="_blank" rel="noopener noreferrer">
          {new URL(src).hostname}
        </a>
      {/each}
    </div>
  {/if}
</div>

{#if !open}
  <button class="open-btn" onclick={onToggle} title="Open AI sidebar">⚡</button>
{/if}

<style>
  .sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    background: #13131a;
    border-right: 1px solid #2d2d3a;
    display: flex;
    flex-direction: column;
    z-index: 10;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    overflow: hidden;
  }
  .sidebar.open { transform: translateX(0); }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #2d2d3a;
    flex-shrink: 0;
  }
  .logo { font-weight: 700; font-size: 14px; color: #6366f1; letter-spacing: 0.05em; }
  .toggle {
    background: none; border: none; color: #64748b;
    cursor: pointer; font-size: 14px; padding: 4px;
  }
  .toggle:hover { color: #e2e8f0; }

  .search-area {
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0;
    border-bottom: 1px solid #2d2d3a;
  }

  .query-input {
    background: #0f0f12;
    border: 1px solid #2d2d3a;
    border-radius: 8px;
    color: #e2e8f0;
    padding: 10px 12px;
    font-size: 13px;
    resize: none;
    outline: none;
    transition: border-color 0.15s;
    font-family: inherit;
    line-height: 1.5;
  }
  .query-input:focus { border-color: #6366f1; }
  .query-input:disabled { opacity: 0.5; }

  .search-btn {
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    align-self: flex-end;
  }
  .search-btn:hover:not(:disabled) { background: #4f46e5; }
  .search-btn:disabled { opacity: 0.4; cursor: default; }

  .phase-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 12px;
    color: #94a3b8;
    flex-shrink: 0;
  }
  .pulse {
    width: 8px; height: 8px;
    background: #6366f1;
    border-radius: 50%;
    animation: pulse 1s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  .error {
    margin: 8px 16px;
    padding: 8px 12px;
    background: #2d0f0f;
    border: 1px solid #7f1d1d;
    border-radius: 6px;
    color: #fca5a5;
    font-size: 12px;
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .results::-webkit-scrollbar { width: 4px; }
  .results::-webkit-scrollbar-track { background: transparent; }
  .results::-webkit-scrollbar-thumb { background: #2d2d3a; border-radius: 2px; }

  .section { display: flex; flex-direction: column; gap: 6px; }
  .section-title {
    font-size: 13px;
    font-weight: 600;
    color: #a5b4fc;
    margin: 0;
  }
  .section-body {
    font-size: 13px;
    line-height: 1.6;
    color: #cbd5e1;
    margin: 0;
    white-space: pre-wrap;
  }

  .sources {
    flex-shrink: 0;
    padding: 12px 16px;
    border-top: 1px solid #2d2d3a;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .sources-label { font-size: 11px; color: #64748b; font-weight: 600; margin-bottom: 4px; }
  .source-link {
    font-size: 12px;
    color: #6366f1;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .source-link:hover { text-decoration: underline; }

  .open-btn {
    position: fixed;
    left: 12px; top: 50%;
    transform: translateY(-50%);
    z-index: 20;
    background: #6366f1;
    color: #fff;
    border: none;
    border-radius: 50%;
    width: 36px; height: 36px;
    font-size: 16px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(99,102,241,0.4);
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .open-btn:hover {
    transform: translateY(-50%) scale(1.1);
    box-shadow: 0 6px 16px rgba(99,102,241,0.6);
  }
</style>
