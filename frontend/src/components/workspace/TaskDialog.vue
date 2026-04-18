<template>
  <OverlayDialog :visible="visible" max-width="560px">
    <div class="task-dialog">
      <q-badge color="primary" class="task-dialog__badge">{{ progress }}</q-badge>
      <h2 class="task-dialog__title">{{ taskTitle }}</h2>

      <p class="task-dialog__description">{{ taskDescription }}</p>

      <div v-if="examplePrompt" class="task-dialog__hint">
        <div class="task-dialog__hint-header">
          <strong>Beispiel-Prompt:</strong>
          <q-btn
            flat
            dense
            round
            size="xs"
            icon="content_copy"
            class="task-dialog__copy-btn"
            @click="copyPrompt"
          >
            <q-tooltip>In Zwischenablage kopieren</q-tooltip>
          </q-btn>
        </div>
        <code>{{ examplePrompt }}</code>
      </div>

      <div class="task-dialog__actions">
        <q-btn
          v-if="!hasStarted"
          color="primary"
          no-caps
          label="Verstanden, Starten"
          icon="play_arrow"
          @click="handleStart"
        />
        <q-btn v-else color="grey-7" no-caps label="Schließen" icon="close" @click="handleClose" />
      </div>
    </div>
  </OverlayDialog>
</template>

<script lang="ts">
import { defineComponent, computed, type PropType } from 'vue';
import OverlayDialog from './OverlayDialog.vue';
import type { StudyTask } from 'src/composables/useWorkspaceStudy';

export default defineComponent({
  name: 'TaskDialog',

  components: { OverlayDialog },

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    task: {
      type: Object as PropType<StudyTask | null>,
      default: null,
    },
    progress: {
      type: String,
      required: true,
    },
    hasStarted: {
      type: Boolean,
      required: true,
    },
  },

  emits: ['start', 'close'],

  setup(props, { emit }) {
    const taskTitle = computed(() => props.task?.title ?? 'Aufgabe');
    const taskDescription = computed(() => props.task?.description ?? '');
    const examplePrompt = computed(() => props.task?.examplePrompt ?? '');

    const copyPrompt = () => {
      const text = examplePrompt.value;
      if (!text) return;
      // Clipboard API braucht HTTPS, sonst fallback
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      } else {
        fallbackCopy(text);
      }
    };

    const fallbackCopy = (text: string) => {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    };

    const handleStart = () => {
      emit('start');
    };

    const handleClose = () => {
      emit('close');
    };

    return {
      taskTitle,
      taskDescription,
      examplePrompt,
      copyPrompt,
      handleStart,
      handleClose,
    };
  },
});
</script>

<style scoped lang="scss">
.task-dialog {
  &__badge {
    margin-bottom: 8px;
  }

  &__title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 8px;
  }

  &__description {
    font-size: 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
    margin: 0 0 16px;
  }

  &__hint {
    background: #f5f5f5;
    border-radius: 6px;
    padding: 10px 12px;
    margin: 0 0 16px;
    font-size: 0.9rem;

    code {
      display: block;
      margin-top: 4px;
      color: #1976d2;
      word-break: break-word;
    }
  }

  &__hint-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  &__copy-btn {
    opacity: 0.6;

    &:hover {
      opacity: 1;
    }
  }

  &__actions {
    text-align: right;
  }
}
</style>
