<template>
  <div class="error-not-found fullscreen text-center q-pa-md flex flex-center">
    <div>
      <div class="error-not-found__code">404</div>
      <div class="error-not-found__message">Seite nicht gefunden</div>
      <q-btn class="q-mt-xl" color="primary" no-caps label="Zum Workspace" to="/" />
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'ErrorNotFound',
});
</script>

<style scoped lang="scss">
.error-not-found {
  background: var(--msl-bg-sidebar);
  color: var(--msl-text-primary);

  &__code {
    font-size: 3rem;
    font-weight: bold;
    opacity: 0.4;
  }

  &__message {
    font-size: 1.25rem;
    margin-top: 16px;
    opacity: 0.7;
  }
}
</style>
