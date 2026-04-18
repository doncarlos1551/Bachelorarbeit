<template>
  <teleport to="body">
    <div v-if="visible" class="overlay-dialog">
      <div class="overlay-dialog__card" :style="{ maxWidth }">
        <div class="overlay-dialog__content">
          <slot />
        </div>
      </div>
    </div>
  </teleport>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'OverlayDialog',

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    maxWidth: {
      type: String,
      default: undefined,
    },
  },
});
</script>

<style scoped lang="scss">
.overlay-dialog {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
  overflow: hidden;
  padding: 20px;
  box-sizing: border-box;

  &__card {
    background: white;
    color: #333;
    border-radius: 16px;
    width: 100%;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    max-height: calc(100vh - 40px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  &__content {
    padding: 32px 40px;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1 1 auto;
    min-height: 0;
  }
}
</style>
