<template>
  <q-page class="workspace-page">
    <section class="workspace-page__iframe">
      <iframe
        v-if="lowcoderUrl"
        :src="lowcoderUrl"
        class="workspace-page__iframe-frame"
        title="Lowcoder Workspace"
      />
      <div v-else class="workspace-page__iframe-empty">Lowcoder-URL fehlt.</div>
    </section>

    <aside class="workspace-page__chat">
      <header class="workspace-page__chat-header">
        <div class="text-subtitle1">MSL Chat</div>
        <div class="text-caption text-grey-6">
          Modus: {{ mode }}<span v-if="isStudyMode"> ({{ studySessionId }})</span>
        </div>
      </header>

      <div ref="chatContainer" class="workspace-page__chat-messages">
        <div v-if="chatMessages.length === 0" class="text-grey-6 text-caption">
          Noch keine Nachrichten. Schreibe etwas, der Assistent ruft die MCP-Tools.
        </div>
        <article
          v-for="(message, index) in chatMessages"
          :key="index"
          class="workspace-page__chat-message"
          :class="`workspace-page__chat-message--${message.role}`"
        >
          <div class="workspace-page__chat-message-role">{{ message.role }}</div>
          <div
            class="workspace-page__chat-message-body"
            v-html="renderMarkdown(message.content)"
          ></div>
        </article>
      </div>

      <form class="workspace-page__chat-input" @submit.prevent="onSubmit">
        <q-input
          v-model="chatInput"
          dense
          outlined
          autogrow
          placeholder="Nachricht an den Assistenten"
          :disable="sending"
        />
        <q-btn
          type="submit"
          color="primary"
          label="Senden"
          :loading="sending"
          :disable="!chatInput.trim()"
        />
      </form>
    </aside>
  </q-page>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import { useWorkspaceConfig } from 'src/composables/useWorkspaceConfig';
import { useWorkspaceChat } from 'src/composables/useWorkspaceChat';
import { useWorkspaceStudy } from 'src/composables/useWorkspaceStudy';
import { renderMarkdown } from 'src/utils/markdown';

export default defineComponent({
  name: 'WorkspacePage',
  setup() {
    const {
      mode,
      isStudyMode,
      studySessionId,
      projectIdFromUrl,
      modelFromUrl,
      backplaneBase,
      lowcoderBase,
      api,
    } = useWorkspaceConfig();

    const study = useWorkspaceStudy();

    const chat = useWorkspaceChat(api, {
      getProjectId: () => projectIdFromUrl.value || null,
      getModel: () => modelFromUrl.value,
      getBackplaneBase: () => backplaneBase,
    });

    const lowcoderUrl = computed(() => {
      if (!lowcoderBase) return '';
      const projectId = projectIdFromUrl.value;
      return projectId ? `${lowcoderBase}/apps/${projectId}/edit` : `${lowcoderBase}/`;
    });

    async function onSubmit() {
      if (!chat.chatInput.value.trim() || chat.sending.value) return;
      await chat.sendMessage();
    }

    return {
      mode,
      isStudyMode,
      studySessionId,
      lowcoderUrl,
      chatMessages: chat.chatMessages,
      chatInput: chat.chatInput,
      sending: chat.sending,
      chatContainer: chat.chatContainer,
      study,
      onSubmit,
      renderMarkdown,
    };
  },
});
</script>

<style scoped lang="scss">
.workspace-page {
  display: flex;
  height: 100vh;
  overflow: hidden;

  &__iframe {
    flex: 1 1 auto;
    min-width: 0;
    background: #f5f5f5;
    position: relative;
  }

  &__iframe-frame {
    width: 100%;
    height: 100%;
    border: 0;
  }

  &__iframe-empty {
    padding: 32px;
    color: #999;
  }

  &__chat {
    flex: 0 0 380px;
    border-left: 1px solid #e0e0e0;
    display: flex;
    flex-direction: column;
    background: #fff;
  }

  &__chat-header {
    padding: 12px 16px;
    border-bottom: 1px solid #eee;
  }

  &__chat-messages {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px 16px;
  }

  &__chat-message {
    margin-bottom: 12px;

    &--user .workspace-page__chat-message-body {
      background: #e3f2fd;
    }

    &--assistant .workspace-page__chat-message-body {
      background: #f5f5f5;
    }
  }

  &__chat-message-role {
    font-size: 11px;
    color: #777;
    margin-bottom: 4px;
    text-transform: uppercase;
  }

  &__chat-message-body {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.4;
  }

  &__chat-input {
    border-top: 1px solid #eee;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
