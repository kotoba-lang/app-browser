<script lang="ts">
  let {
    url,
    sidebarWidth,
    onNavigate
  }: {
    url: string;
    sidebarWidth: number;
    onNavigate: (url: string) => void;
  } = $props();

  let inputUrl = $state(url);
  let loading = $state(false);
  let iframeRef = $state<HTMLIFrameElement | null>(null);

  $effect(() => { inputUrl = url; });

  function normalizeUrl(raw: string): string {
    const s = raw.trim();
    if (!s) return 'https://www.google.com';
    if (/^https?:\/\//i.test(s)) return s;
    if (/^localhost|^127\.|^192\.168\.|^10\./.test(s)) return `http://${s}`;
    if (s.includes('.') && !s.includes(' ')) return `https://${s}`;
    return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  }

  function navigate() {
    const target = normalizeUrl(inputUrl);
    inputUrl = target;
    onNavigate(target);
    loading = true;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') navigate();
  }

  function onLoad() { loading = false; }
</script>

<div class="pane" style="left: {sidebarWidth}px; width: calc(100% - {sidebarWidth}px)">
  <div class="urlbar">
    <button class="nav-btn" onclick={() => iframeRef?.contentWindow?.history.back()} title="Back">
      ←
    </button>
    <button class="nav-btn" onclick={() => iframeRef?.contentWindow?.history.forward()} title="Forward">
      →
    </button>
    <button class="nav-btn" onclick={() => { loading = true; iframeRef?.contentWindow?.location.reload(); }} title="Reload">
      ↺
    </button>
    <div class="url-wrap">
      {#if loading}
        <span class="spinner"></span>
      {/if}
      <input
        class="url-input"
        type="text"
        bind:value={inputUrl}
        onkeydown={onKeydown}
        onfocus={(e) => (e.target as HTMLInputElement).select()}
        placeholder="Search or enter URL..."
        spellcheck={false}
        autocomplete="off"
      />
    </div>
    <button class="nav-btn go" onclick={navigate}>Go</button>
  </div>

  <div class="viewport">
    <iframe
      bind:this={iframeRef}
      src={url}
      title="Browser viewport"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      onload={onLoad}
    ></iframe>
  </div>
</div>

<style>
  .pane {
    position: fixed;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    transition: left 0.2s ease, width 0.2s ease;
    background: #fff;
  }

  .urlbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    background: #1e1e26;
    border-bottom: 1px solid #2d2d3a;
    flex-shrink: 0;
  }

  .nav-btn {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 16px;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.1s;
    flex-shrink: 0;
  }
  .nav-btn:hover { background: #2d2d3a; color: #e2e8f0; }
  .nav-btn.go { font-size: 12px; font-weight: 600; color: #6366f1; }

  .url-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    background: #0f0f12;
    border-radius: 6px;
    padding: 0 10px;
    gap: 8px;
  }

  .url-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 13px;
    padding: 6px 0;
    min-width: 0;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #374151;
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .viewport {
    flex: 1;
    overflow: hidden;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    background: #fff;
  }
</style>
