<template>
  <OverlayDialog :visible="visible" max-width="520px">
    <div class="ratings">
      <h2 class="ratings__title">Bewertung</h2>

      <div v-for="scale in ratingScales" :key="scale.key" class="ratings__scale">
        <div class="ratings__scale-label">{{ scale.label }}</div>
        <q-slider
          :model-value="modelValue[scale.key]"
          :min="1"
          :max="7"
          :step="1"
          snap
          markers
          marker-labels
          color="primary"
          @update:model-value="(newValue: number | null) => updateRating(scale.key, newValue ?? 4)"
        />
        <div class="ratings__scale-anchors">
          <span>1 = stimme gar nicht zu</span>
          <span>7 = stimme voll zu</span>
        </div>
      </div>

      <div class="ratings__success">
        <q-checkbox
          :model-value="taskSucceeded"
          label="Die Aufgabe wurde aus meiner Sicht erfolgreich gelöst"
          color="primary"
          dense
          @update:model-value="(value: boolean) => handleTaskSucceeded(value)"
        />
      </div>

      <div class="ratings__notes">
        <div class="ratings__notes-label">Anmerkungen (optional)</div>
        <q-input
          :model-value="notes"
          type="textarea"
          outlined
          rows="2"
          dense
          @update:model-value="handleNotesUpdate"
        />
      </div>

      <div class="ratings__actions">
        <q-btn
          flat
          no-caps
          color="grey-7"
          size="sm"
          label="Zurück zur Aufgabe"
          icon="arrow_back"
          @click="handleBack"
        />
        <q-btn
          color="primary"
          no-caps
          :label="submitButtonLabel"
          icon="arrow_forward"
          :loading="submitting"
          @click="handleSubmit"
        />
      </div>
    </div>
  </OverlayDialog>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import OverlayDialog from './OverlayDialog.vue';

const RATING_SCALES = [
  { key: 'trust', label: 'Ich vertraue der vorgeschlagenen Änderung' },
  { key: 'confidence', label: 'Ich bin sicher in meiner Entscheidung' },
  { key: 'transparency', label: 'Ich verstehe, was sich konkret ändert' },
  { key: 'control', label: 'Ich habe ausreichend Kontrolle über den Prozess' },
] as const;

export default defineComponent({
  name: 'RatingsDialog',

  components: { OverlayDialog },

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
    modelValue: {
      type: Object as () => Record<string, number>,
      required: true,
    },
    notes: {
      type: String,
      required: true,
    },
    taskSucceeded: {
      type: Boolean,
      required: true,
    },
    isLast: {
      type: Boolean,
      required: true,
    },
    submitting: {
      type: Boolean,
      default: false,
    },
  },

  emits: ['update:modelValue', 'update:notes', 'update:taskSucceeded', 'submit', 'back'],

  setup(props, { emit }) {
    const ratingScales = RATING_SCALES;

    const submitButtonLabel = computed(() =>
      props.isLast ? 'Absenden & Abschließen' : 'Absenden & Weiter',
    );

    const updateRating = (key: string, value: number) => {
      emit('update:modelValue', { ...props.modelValue, [key]: value });
    };

    const handleNotesUpdate = (value: string | number | null) => {
      emit('update:notes', value);
    };

    const handleTaskSucceeded = (value: boolean) => {
      emit('update:taskSucceeded', value);
    };

    const handleSubmit = () => {
      emit('submit');
    };

    const handleBack = () => {
      emit('back');
    };

    return {
      ratingScales,
      submitButtonLabel,
      updateRating,
      handleNotesUpdate,
      handleTaskSucceeded,
      handleSubmit,
      handleBack,
    };
  },
});
</script>

<style scoped lang="scss">
.ratings {
  &__title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 20px;
  }

  &__scale {
    margin-bottom: 16px;
  }

  &__scale-label {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 4px;
  }

  &__scale-anchors {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: #757575;
    margin-top: -4px;
    padding: 0 4px;
  }

  &__notes {
    margin-top: 16px;
  }

  &__notes-label {
    font-size: 0.875rem;
    font-weight: 500;
    margin-bottom: 4px;
  }

  &__actions {
    margin-top: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
</style>
