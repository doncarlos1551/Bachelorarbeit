<template>
  <div class="top-bar">
    <q-select
      v-if="showProjectPicker"
      :model-value="selectedProject"
      :options="filteredOptions"
      option-label="label"
      option-value="value"
      emit-value
      map-options
      dense
      outlined
      use-input
      input-debounce="100"
      placeholder="Projekt suchen..."
      class="top-bar__project-select"
      :loading="loadingProjects"
      @filter="handleProjectFilter"
      @update:model-value="handleProjectChange"
    >
      <template #no-option>
        <q-item>
          <q-item-section class="text-grey">Kein Projekt gefunden</q-item-section>
        </q-item>
      </template>
    </q-select>

    <q-btn-toggle
      :model-value="lowcoderMode"
      dense
      flat
      no-caps
      toggle-color="primary"
      :options="lowcoderModeOptions"
      class="top-bar__mode-toggle"
      @update:model-value="handleLowcoderModeChange"
    />

    <q-btn flat dense icon="refresh" @click="handleRefresh" />

    <slot name="append" />

    <!-- Mode stack: gates plus UI filter -->
    <div class="top-bar__mode-stack" :class="{ 'top-bar__mode-stack--compact': hidePresets }">
      <q-btn-dropdown
        v-if="!hidePresets"
        dense
        flat
        no-caps
        size="sm"
        :color="mslStatusColor"
        :label="`Gates · ${mslStatus || '-'}`"
        title="Backend-Gate-Policy (wirkt auf Blocking + Approval-Zwang). Unabhängig vom UI-Filter."
        class="top-bar__mode-stack-top"
      >
        <q-list dense>
          <q-item clickable v-close-popup @click="handlePresetChange('off')">
            <q-item-section avatar><q-icon name="block" color="grey" size="xs" /></q-item-section>
            <q-item-section>
              <q-item-label>OFF</q-item-label>
              <q-item-label caption>Keine Gate-Auswertung, keine Audit-Logs.</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable v-close-popup @click="handlePresetChange('observe')">
            <q-item-section avatar
              ><q-icon name="visibility" color="warning" size="xs"
            /></q-item-section>
            <q-item-section>
              <q-item-label>OBSERVE</q-item-label>
              <q-item-label caption>Pipeline läuft, nichts blockiert. Approval aus.</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable v-close-popup @click="handlePresetChange('enforce')">
            <q-item-section avatar
              ><q-icon name="security" color="negative" size="xs"
            /></q-item-section>
            <q-item-section>
              <q-item-label>ENFORCE</q-item-label>
              <q-item-label caption
                >Policy/Validation blocken, Approval bei Risk &ge; medium.
                Studien-Normalmodus.</q-item-label
              >
            </q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>

      <span class="top-bar__mode-stack-bottom" :title="modeTitle">{{ modeLabel }}</span>
    </div>

    <!-- nur im free mode -->
    <q-btn
      v-if="!isStudyMode"
      dense
      flat
      icon="more_vert"
      class="top-bar__menu"
      :loading="clearingPlans"
      title="Aktionen"
    >
      <q-menu anchor="bottom right" self="top right">
        <q-list dense style="min-width: 200px">
          <q-item clickable v-close-popup @click="handleClearPlans">
            <q-item-section avatar>
              <q-icon name="delete_sweep" color="negative" size="sm" />
            </q-item-section>
            <q-item-section>
              <q-item-label>Clear plans</q-item-label>
              <q-item-label caption>Alle offenen Pläne rejecten und UI leeren</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-menu>
    </q-btn>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue';

const LOWCODER_MODE_OPTIONS = [
  { label: 'Preview', value: 'preview' },
  { label: 'Edit', value: 'edit' },
];

export default defineComponent({
  name: 'TopBar',

  props: {
    showProjectPicker: {
      type: Boolean,
      required: true,
    },
    selectedProject: {
      type: String as PropType<string | null>,
      default: null,
    },
    projectOptions: {
      type: Array as PropType<Array<{ label: string; value: string }>>,
      required: true,
    },
    loadingProjects: {
      type: Boolean,
      default: false,
    },
    lowcoderMode: {
      type: String as PropType<'preview' | 'edit'>,
      required: true,
    },
    mslStatus: {
      type: String,
      required: true,
    },
    hidePresets: {
      type: Boolean,
      default: false,
    },
    currentVariant: {
      type: String as PropType<'summary' | 'diff' | 'diff_risk' | 'full' | ''>,
      default: '',
    },
    isStudyMode: {
      type: Boolean,
      default: false,
    },
    clearingPlans: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    'update:selectedProject',
    'update:lowcoderMode',
    'refresh',
    'set-msl-preset',
    'clear-plans',
  ],

  setup(props, { emit }) {
    const filteredOptions = ref(props.projectOptions);
    const lowcoderModeOptions = LOWCODER_MODE_OPTIONS;

    const mslStatusColor = computed(() => {
      if (props.mslStatus === 'ENFORCE') return 'negative';
      if (props.mslStatus === 'OBSERVE') return 'warning';
      return 'grey-6';
    });

    const VARIANT_LABELS: Record<string, string> = {
      summary: 'UI · summary',
      diff: 'UI · diff',
      diff_risk: 'UI · diff+risk',
      full: 'UI · full',
    };
    const modeLabel = computed(
      () => (props.currentVariant && VARIANT_LABELS[props.currentVariant]) || 'UI · full',
    );
    const modeTitle = computed(() => {
      const active = props.currentVariant || 'full';
      return props.isStudyMode
        ? `Studien-Variante (Frontend-Filter): ${active}. Backend liefert in allen Varianten identische Daten, Filterung erfolgt im Template.`
        : `Frontend-Filter: ${active}. 'full' zeigt alle MSL-Felder (Default im Free-Mode).`;
    });

    const handleProjectFilter = (
      filterValue: string,
      updateCallback: (callback: () => void) => void,
    ) => {
      updateCallback(() => {
        const searchTerm = filterValue.toLowerCase();
        filteredOptions.value = searchTerm
          ? props.projectOptions.filter((project) =>
              project.label.toLowerCase().includes(searchTerm),
            )
          : props.projectOptions;
      });
    };

    const handleProjectChange = (value: string | null) => {
      emit('update:selectedProject', value);
    };

    const handleLowcoderModeChange = (value: 'preview' | 'edit') => {
      emit('update:lowcoderMode', value);
    };

    const handleRefresh = () => {
      emit('refresh');
    };

    const handlePresetChange = (preset: 'off' | 'observe' | 'enforce') => {
      emit('set-msl-preset', preset);
    };

    const handleClearPlans = () => {
      emit('clear-plans');
    };

    return {
      filteredOptions,
      lowcoderModeOptions,
      mslStatusColor,
      modeLabel,
      modeTitle,
      handleProjectFilter,
      handleProjectChange,
      handleLowcoderModeChange,
      handleRefresh,
      handlePresetChange,
      handleClearPlans,
    };
  },
});
</script>

<style scoped lang="scss">
.top-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--msl-bg-surface);
  background: var(--msl-bg-sidebar);

  &__project-select {
    flex: 1;

    :deep(.q-field__control) {
      background: var(--msl-bg-surface);
      color: var(--msl-text-primary);
    }

    :deep(.q-field__native),
    :deep(.q-field__input) {
      color: var(--msl-text-primary);
    }
  }

  &__mode-toggle {
    margin: 0 4px;
    font-size: 11px;
  }

  &__mode-stack {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    min-width: 150px;

    &--compact {
      min-width: 110px;
    }

    :deep(.q-btn-dropdown) {
      font-size: 11px;
      width: 100%;
      justify-content: center;
    }
  }

  &__mode-stack-top {
    width: 100%;
  }

  &__mode-stack-bottom {
    display: block;
    width: 100%;
    text-align: center;
    font-size: 9px;
    letter-spacing: 0.3px;
    color: var(--msl-text-secondary, rgba(255, 255, 255, 0.55));
    padding: 1px 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    font-family: monospace;
    line-height: 1.4;
    cursor: help;
  }

  &__menu {
    margin-left: 4px;
  }
}
</style>
