<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
  <title>AI Browser — browser.etzhayyim.ai</title>
</svelte:head>

{@render children()}

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f0f12;
    color: #e2e8f0;
    height: 100dvh;
    overflow: hidden;
  }
</style>
