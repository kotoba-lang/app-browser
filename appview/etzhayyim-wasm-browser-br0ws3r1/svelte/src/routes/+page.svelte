<script lang="ts">
  import BrowserPane from '$lib/BrowserPane.svelte';
  import Sidebar from '$lib/Sidebar.svelte';

  let currentUrl = $state('https://www.google.com');
  let sidebarOpen = $state(true);

  const SIDEBAR_WIDTH = 400;
</script>

<div class="shell">
  <Sidebar
    open={sidebarOpen}
    width={SIDEBAR_WIDTH}
    pageUrl={currentUrl}
    onToggle={() => sidebarOpen = !sidebarOpen}
  />
  <BrowserPane
    url={currentUrl}
    sidebarWidth={sidebarOpen ? SIDEBAR_WIDTH : 0}
    onNavigate={(url) => currentUrl = url}
  />
</div>

<style>
  .shell {
    display: flex;
    height: 100dvh;
    width: 100vw;
    overflow: hidden;
    background: #0f0f12;
  }
</style>
