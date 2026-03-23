<template>
  <div class="workspace-layout">
    <router-view />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'WorkspaceLayout',
});
</script>

<style scoped lang="scss">
.workspace-layout {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
