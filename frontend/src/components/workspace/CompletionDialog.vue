<template>
  <OverlayDialog :visible="visible" max-width="560px">
    <div class="completion">
      <h2 class="completion__title">Studie abschließen</h2>
      <p class="completion__subtitle">
        Vielen Dank! Bitte beantworten Sie noch ein paar abschließende Fragen.
      </p>

      <div class="completion__section-label">Allgemeine Bewertung</div>
      <div v-for="(item, index) in susLabels" :key="index" class="completion__sus-item">
        <div class="completion__sus-label">{{ item }}</div>
        <q-slider
          :model-value="susItems[index]"
          :min="1"
          :max="5"
          :step="1"
          snap
          markers
          marker-labels
          color="primary"
          @update:model-value="(newValue: number | null) => handleSusUpdate(index, newValue ?? 3)"
        />
        <div class="completion__scale-anchors">
          <span>1 = stimme nicht zu</span>
          <span>5 = stimme zu</span>
        </div>
      </div>

      <q-separator class="completion__separator" />

      <div class="completion__section-label">Gesamtvertrauen in das MSL-System</div>
      <q-slider
        :model-value="overallTrust"
        :min="1"
        :max="7"
        :step="1"
        snap
        markers
        marker-labels
        color="primary"
        class="completion__trust-slider"
        @update:model-value="handleOverallTrustUpdate"
      />
      <div class="completion__scale-anchors completion__scale-anchors--trust">
        <span>1 = gar kein Vertrauen</span>
        <span>7 = volles Vertrauen</span>
      </div>

      <div class="completion__section-label">Würde ich ein solches System nutzen?</div>
      <q-btn-toggle
        :model-value="wouldUse"
        spread
        no-caps
        toggle-color="primary"
        :options="wouldUseOptions"
        class="completion__toggle"
        @update:model-value="handleWouldUseUpdate"
      />

      <div class="completion__section-label">Anmerkungen / Feedback (optional)</div>
      <q-input
        :model-value="feedback"
        type="textarea"
        outlined
        rows="3"
        dense
        class="completion__feedback"
        @update:model-value="handleFeedbackUpdate"
      />

      <div class="completion__actions">
        <q-btn
          color="positive"
          no-caps
          label="Studie abschließen"
          icon="check"
          :loading="submitting"
          @click="handleComplete"
        />
      </div>
    </div>
  </OverlayDialog>
</template>

<script lang="ts">
import { defineComponent, type PropType } from 'vue';
import OverlayDialog from './OverlayDialog.vue';

// SUS Brooke 1996, alternierende Polung
const SUS_LABELS = [
  'Ich denke, dass ich das System gerne häufig benutzen würde.',
  'Ich fand das System unnötig komplex.',
  'Ich fand das System einfach zu benutzen.',
  'Ich denke, ich würde die Hilfe einer technischen Person brauchen.',
  'Ich fand, die verschiedenen Funktionen waren gut integriert.',
  'Ich denke, das System enthielt zu viele Inkonsistenzen.',
  'Ich kann mir vorstellen, dass die meisten Menschen dieses System schnell erlernen.',
  'Ich fand das System sehr umständlich zu benutzen.',
  'Ich fühlte mich bei der Benutzung des Systems sehr sicher.',
  'Ich musste eine Menge lernen, bevor ich mit dem System arbeiten konnte.',
] as const;

const WOULD_USE_OPTIONS = [
  { label: 'Ja', value: 'yes' },
  { label: 'Vielleicht', value: 'maybe' },
  { label: 'Nein', value: 'no' },
];

export default defineComponent({
  name: 'CompletionDialog',

  components: { OverlayDialog },

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    susItems: {
      type: Array as PropType<number[]>,
      required: true,
    },
    overallTrust: {
      type: Number,
      required: true,
    },
    wouldUse: {
      type: String as PropType<'yes' | 'maybe' | 'no'>,
      required: true,
    },
    feedback: {
      type: String,
      required: true,
    },
    submitting: {
      type: Boolean,
      default: false,
    },
  },

  emits: [
    'update:susItems',
    'update:overallTrust',
    'update:wouldUse',
    'update:feedback',
    'complete',
  ],

  setup(props, { emit }) {
    const susLabels = SUS_LABELS;
    const wouldUseOptions = WOULD_USE_OPTIONS;

    const handleSusUpdate = (index: number, value: number) => {
      const updatedItems = [...props.susItems];
      updatedItems[index] = value;
      emit('update:susItems', updatedItems);
    };

    const handleOverallTrustUpdate = (value: number | null) => {
      emit('update:overallTrust', value);
    };

    const handleWouldUseUpdate = (value: string | number | null) => {
      emit('update:wouldUse', value);
    };

    const handleFeedbackUpdate = (value: string | number | null) => {
      emit('update:feedback', value);
    };

    const handleComplete = () => {
      emit('complete');
    };

    return {
      susLabels,
      wouldUseOptions,
      handleSusUpdate,
      handleOverallTrustUpdate,
      handleWouldUseUpdate,
      handleFeedbackUpdate,
      handleComplete,
    };
  },
});
</script>

<style scoped lang="scss">
.completion {
  &__title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 8px;
  }

  &__subtitle {
    font-size: 0.875rem;
    color: var(--msl-text-secondary);
    margin: 0 0 20px;
  }

  &__section-label {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 8px;
  }

  &__sus-item {
    margin-bottom: 8px;
  }

  &__sus-label {
    font-size: 0.75rem;
    color: var(--msl-text-secondary);
  }

  &__scale-anchors {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: var(--msl-text-secondary);
    margin-top: -4px;
    padding: 0 4px;

    &--trust {
      margin-bottom: 16px;
    }
  }

  &__separator {
    margin: 16px 0;
  }

  &__trust-slider {
    margin-bottom: 16px;
  }

  &__toggle {
    margin-bottom: 16px;
  }

  &__feedback {
    margin-bottom: 16px;
  }

  &__actions {
    text-align: right;
  }
}
</style>
