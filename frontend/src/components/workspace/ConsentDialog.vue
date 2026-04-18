<template>
  <OverlayDialog :visible="visible" max-width="600px">
    <div class="consent">
      <h2 class="consent__title">Teilnahme an der Studie</h2>

      <p class="consent__text">
        Im Rahmen dieser Studie werden Sie gebeten, von einer KI vorgeschlagene Änderungen an einer
        Low-Code-Anwendung zu bewerten. Dabei werden verschiedene Darstellungsformen getestet.
      </p>

      <div class="consent__details">
        <strong>Was wird erhoben:</strong>
        <ul>
          <li>Ihre Entscheidungen (Freigeben/Ablehnen)</li>
          <li>Bewertungen auf 7-Punkt-Skalen (Vertrauen, Sicherheit, etc.)</li>
          <li>Bearbeitungszeiten</li>
          <li>Optionale Freitext-Anmerkungen</li>
        </ul>
      </div>

      <p class="consent__text">
        Alle Daten werden anonymisiert und ausschließlich für die Bachelorarbeit verwendet. Die
        Teilnahme ist freiwillig und kann jederzeit abgebrochen werden.
      </p>

      <q-checkbox
        v-model="consentAccepted"
        label="Ich habe die Informationen gelesen und stimme der Teilnahme zu."
        class="consent__checkbox"
      />

      <div class="consent__actions">
        <q-btn
          color="primary"
          no-caps
          label="Studie starten"
          icon="arrow_forward"
          :disable="!consentAccepted"
          @click="handleAccept"
        />
      </div>
    </div>
  </OverlayDialog>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';
import OverlayDialog from './OverlayDialog.vue';

export default defineComponent({
  name: 'ConsentDialog',

  components: { OverlayDialog },

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
  },

  emits: ['accept'],

  setup(_props, { emit }) {
    const consentAccepted = ref(false);

    const handleAccept = () => {
      emit('accept');
    };

    return {
      consentAccepted,
      handleAccept,
    };
  },
});
</script>

<style scoped lang="scss">
.consent {
  &__title {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 16px;
  }

  &__text {
    font-size: 0.875rem;
    line-height: 1.6;
    margin: 0 0 12px;
  }

  &__details {
    font-size: 0.875rem;
    margin: 0 0 16px;

    ul {
      margin: 4px 0 0;
      padding-left: 20px;
    }
  }

  &__checkbox {
    margin-top: 8px;
  }

  &__actions {
    margin-top: 20px;
    text-align: right;
  }
}
</style>
