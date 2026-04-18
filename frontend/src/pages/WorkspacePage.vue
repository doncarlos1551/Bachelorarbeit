<template>
  <div class="workspace">
    <!-- Lowcoder iframe (links) -->
    <div class="workspace__lowcoder" :style="{ width: lowcoderWidth + 'px' }">
      <iframe
        v-if="lowcoderUrl"
        ref="lowcoderFrame"
        :src="lowcoderUrl"
        class="workspace__iframe"
        allow="clipboard-write"
      />
      <div v-else class="workspace__placeholder">
        <q-icon name="web" size="64px" color="grey-5" />
        <div class="text-grey-6 q-mt-md">Kein Projekt ausgewählt</div>
      </div>
    </div>

    <!-- Drag-Handle -->
    <div class="workspace__handle" title="Ziehen zum Anpassen" @mousedown.prevent="startResize">
      <div class="workspace__handle-dots">
        <div />
        <div />
        <div />
      </div>
    </div>

    <!-- Sidebar: TopBar + Chat + MSL -->
    <div class="workspace__sidebar">
      <TopBar
        :show-project-picker="!config.isStudyMode.value"
        :selected-project="selectedProject"
        :project-options="projectOptions"
        :loading-projects="loadingProjects"
        :lowcoder-mode="lowcoderMode"
        :msl-status="msl.mslStatus.value"
        :hide-presets="config.isStudyMode.value"
        :current-variant="currentVariant"
        :is-study-mode="config.isStudyMode.value"
        :clearing-plans="clearingPlans"
        @update:selected-project="handleProjectSelection"
        @update:lowcoder-mode="handleLowcoderModeChange"
        @refresh="refreshLowcoder"
        @set-msl-preset="setMslPreset"
        @clear-plans="clearAllPlans"
      >
        <!-- Study: Task-Badge in der TopBar -->
        <template v-if="config.isStudyMode.value && study.currentTask.value" #append>
          <q-badge color="primary" class="cursor-pointer q-ml-sm" @click="study.openTaskDialog()">
            {{ study.progress.value }} - {{ study.currentTask.value.title }}
          </q-badge>
        </template>
      </TopBar>

      <!-- Chat-Nachrichten -->
      <div
        :ref="
          (element) => {
            chat.chatContainer.value = element as HTMLElement | null;
          }
        "
        class="workspace__chat"
      >
        <div class="workspace__chat-inner">
          <div v-if="chat.chatMessages.value.length === 0" class="workspace__chat-empty">
            <q-icon name="chat" size="32px" color="grey-5" />
            <div class="text-grey-6 q-mt-sm text-caption">Schreibe einen Prompt um zu starten</div>
          </div>

          <div
            v-for="(message, messageIndex) in chat.chatMessages.value"
            :key="messageIndex"
            class="workspace__chat-message"
          >
            <!-- User -->
            <template v-if="message.role === 'user'">
              <div class="workspace__bubble workspace__bubble--user">{{ message.content }}</div>
            </template>

            <!-- Assistant -->
            <template v-else-if="message.role === 'assistant'">
              <!-- Markdown: escaped plus http/https links -->
              <div
                class="workspace__bubble workspace__bubble--assistant workspace__bubble--markdown"
                v-html="renderAssistantMarkdown(message.content)"
              ></div>
            </template>

            <!-- MSL -->
            <template v-else-if="message.role === 'msl'">
              <div
                class="workspace__bubble workspace__bubble--msl"
                :class="mslBubbleClass(message)"
              >
                <div
                  v-for="toolCall in mslToolCalls(message)"
                  :key="toolCall.toolCallId"
                  class="workspace__msl-toolcall"
                >
                  <!-- Header: MCP Tool-Name + Status + Risk-Badge -->
                  <div class="workspace__msl-header">
                    <q-icon
                      :name="mslStatusIcon(message)"
                      :color="mslStatusColor(message)"
                      size="16px"
                    />
                    <code class="workspace__msl-tool-name">{{
                      toolCall.toolName || 'MSL-Plan'
                    }}</code>
                    <span class="workspace__msl-tool-status">{{ mslStatusLabel(message) }}</span>
                    <q-badge
                      v-if="message.riskLevel && showRiskBadge()"
                      :color="riskLevelColor(message.riskLevel)"
                      class="workspace__msl-risk-badge"
                    >
                      {{ message.riskLevel.toUpperCase()
                      }}<span v-if="message.riskScore != null"> ({{ message.riskScore }})</span>
                    </q-badge>
                  </div>

                  <!-- Error details: tool failure before MSL -->
                  <q-expansion-item
                    v-if="message.toolError"
                    dense
                    dense-toggle
                    expand-icon-toggle
                    :default-opened="true"
                    icon="error"
                    label="Fehlerdetails"
                    header-class="workspace__msl-section-header workspace__msl-section-header--error"
                    class="workspace__msl-section"
                  >
                    <pre class="workspace__msl-args-pre">{{ message.toolError }}</pre>
                  </q-expansion-item>

                  <!-- Tool args: only with payload -->
                  <q-expansion-item
                    v-if="toolCall.args && Object.keys(toolCall.args).length"
                    dense
                    dense-toggle
                    expand-icon-toggle
                    :default-opened="false"
                    icon="code"
                    label="Tool-Parameter"
                    header-class="workspace__msl-section-header"
                    class="workspace__msl-section"
                  >
                    <pre class="workspace__msl-args-pre">{{
                      JSON.stringify(toolCall.args, null, 2)
                    }}</pre>
                  </q-expansion-item>

                  <!-- MSL details: variant plus content -->
                  <q-expansion-item
                    v-if="showDetailsContainer() && hasAnyMslContent(message)"
                    dense
                    dense-toggle
                    expand-icon-toggle
                    :default-opened="isMslDetailsDefaultOpen(message)"
                    icon="shield"
                    label="MSL-Details"
                    header-class="workspace__msl-section-header"
                    class="workspace__msl-section"
                  >
                    <!-- Block reason: gate plus affected IDs -->
                    <div
                      v-if="
                        message.blockReason ||
                        message.blockMissingRefs?.length ||
                        message.blockSelfContradictions?.length ||
                        message.blockViolations?.length
                      "
                      class="workspace__msl-block-reason"
                    >
                      <div class="workspace__msl-block-reason-header">
                        <q-icon name="block" size="14px" class="q-mr-xs" />
                        <span class="text-weight-medium">
                          Grund der Ablehnung
                          <span v-if="message.blockGate" class="text-caption q-ml-xs">
                            (Gate: {{ blockGateLabel(message.blockGate) }})
                          </span>
                        </span>
                      </div>
                      <div v-if="message.blockReason" class="workspace__msl-block-reason-text">
                        {{ message.blockReason }}
                      </div>
                      <div
                        v-if="message.blockMissingRefs?.length"
                        class="workspace__msl-block-list"
                      >
                        <div class="text-caption text-grey-5">Nicht vorhandene Komponenten:</div>
                        <ul>
                          <li v-for="ref in message.blockMissingRefs" :key="ref">{{ ref }}</li>
                        </ul>
                      </div>
                      <div
                        v-if="message.blockSelfContradictions?.length"
                        class="workspace__msl-block-list"
                      >
                        <div class="text-caption text-grey-5">Widersprüchliche Operationen:</div>
                        <ul>
                          <li v-for="line in message.blockSelfContradictions" :key="line">
                            {{ line }}
                          </li>
                        </ul>
                      </div>
                      <div v-if="message.blockViolations?.length" class="workspace__msl-block-list">
                        <div class="text-caption text-grey-5">Regel-Verletzungen:</div>
                        <ul>
                          <li v-for="line in message.blockViolations" :key="line">{{ line }}</li>
                        </ul>
                      </div>
                    </div>

                    <template v-if="showDiffBlock()">
                      <div
                        v-if="
                          message.diffEntries?.length ||
                          message.diffSummary?.length ||
                          message.diffHeadline
                        "
                        class="workspace__msl-diff"
                      >
                        <div class="workspace__msl-diff-header">
                          <q-icon name="compare_arrows" size="14px" class="q-mr-xs" />
                          <span class="text-weight-medium">Änderungen</span>
                          <span
                            v-if="message.diffCounts"
                            class="text-caption q-ml-xs workspace__msl-diff-counts"
                          >
                            ({{
                              message.diffCounts.semantic + message.diffCounts.structural
                            }}
                            relevant, {{ message.diffCounts.metadata }} Metadaten)
                          </span>
                        </div>
                        <div v-if="message.diffHeadline" class="workspace__msl-diff-headline">
                          {{ message.diffHeadline }}
                        </div>

                        <!-- Diff entries: preferred rendering -->
                        <div v-if="message.diffEntries?.length" class="workspace__msl-diff-entries">
                          <div
                            v-for="(entry, idx) in message.diffEntries"
                            :key="idx"
                            class="workspace__msl-diff-entry"
                          >
                            <div class="workspace__msl-diff-entry-headline">
                              {{ entry.headline }}
                            </div>
                            <div
                              v-if="entry.oldValue !== undefined"
                              class="workspace__msl-diff-value workspace__msl-diff-value--old"
                            >
                              <span class="workspace__msl-diff-value-label">vorher</span>
                              <pre v-if="entry.multiline" class="workspace__msl-diff-value-pre">{{
                                entry.oldValue
                              }}</pre>
                              <code v-else class="workspace__msl-diff-value-inline">{{
                                entry.oldValue
                              }}</code>
                            </div>
                            <div
                              v-if="entry.newValue !== undefined"
                              class="workspace__msl-diff-value workspace__msl-diff-value--new"
                            >
                              <span class="workspace__msl-diff-value-label">nachher</span>
                              <pre v-if="entry.multiline" class="workspace__msl-diff-value-pre">{{
                                entry.newValue
                              }}</pre>
                              <code v-else class="workspace__msl-diff-value-inline">{{
                                entry.newValue
                              }}</code>
                            </div>
                            <!-- Remove diff: explicit empty after-value -->
                            <div
                              v-else-if="entry.oldValue !== undefined"
                              class="workspace__msl-diff-value workspace__msl-diff-value--new workspace__msl-diff-value--empty"
                            >
                              <span class="workspace__msl-diff-value-label">nachher</span>
                              <code class="workspace__msl-diff-value-inline">∅ (entfernt)</code>
                            </div>
                          </div>
                        </div>
                        <ul
                          v-else-if="message.diffSummary?.length"
                          class="workspace__msl-diff-list"
                        >
                          <li v-for="line in message.diffSummary" :key="line">{{ line }}</li>
                        </ul>
                      </div>
                      <div v-else class="workspace__msl-empty">Keine Änderungen ermittelt.</div>
                    </template>

                    <div
                      v-if="showRiskTags() && message.riskTags?.length"
                      class="workspace__msl-tags"
                    >
                      <q-badge
                        v-for="tag in message.riskTags"
                        :key="tag"
                        color="blue-grey-7"
                        class="workspace__msl-tag"
                        >{{ tag }}</q-badge
                      >
                    </div>

                    <!-- Reasoning sections: structured first -->
                    <template v-if="showApprovalReasoning()">
                      <div
                        v-if="message.riskReasons?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--reasons"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="info" size="12px" class="q-mr-xs" />Gründe
                        </div>
                        <ul>
                          <li v-for="r in message.riskReasons" :key="r">{{ r }}</li>
                        </ul>
                      </div>
                      <div
                        v-if="message.policyViolations?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--errors"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="gavel" size="12px" class="q-mr-xs" />Policy-Verstöße
                        </div>
                        <ul>
                          <li v-for="p in message.policyViolations" :key="p">{{ p }}</li>
                        </ul>
                      </div>
                      <div
                        v-if="message.validationErrors?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--errors"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="error" size="12px" class="q-mr-xs" />Fehler
                        </div>
                        <ul>
                          <li v-for="e in message.validationErrors" :key="e">{{ e }}</li>
                        </ul>
                      </div>
                      <div
                        v-if="message.validationWarnings?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--warnings"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="warning" size="12px" class="q-mr-xs" />Warnungen
                        </div>
                        <ul>
                          <li v-for="w in message.validationWarnings" :key="w">{{ w }}</li>
                        </ul>
                      </div>
                      <div
                        v-if="message.externalEndpoints?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--external"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="link" size="12px" class="q-mr-xs" />Externe Endpunkte
                        </div>
                        <ul>
                          <li v-for="u in message.externalEndpoints" :key="u">
                            <code>{{ u }}</code>
                          </li>
                        </ul>
                      </div>
                      <div
                        v-if="message.recommendations?.length"
                        class="workspace__msl-rsection workspace__msl-rsection--recommendations"
                      >
                        <div class="workspace__msl-rsection-title">
                          <q-icon name="lightbulb" size="12px" class="q-mr-xs" />Empfehlungen
                        </div>
                        <ul>
                          <li v-for="r in message.recommendations" :key="r">{{ r }}</li>
                        </ul>
                      </div>
                      <!-- Legacy fallback: old DB plans -->
                      <div
                        v-if="
                          message.approvalReasoning &&
                          !message.riskReasons?.length &&
                          !message.policyViolations?.length &&
                          !message.validationWarnings?.length &&
                          !message.recommendations?.length
                        "
                        class="workspace__msl-reasoning"
                      >
                        {{ message.approvalReasoning }}
                      </div>
                    </template>
                  </q-expansion-item>
                </div>

                <!-- Plan actions: open plan only -->
                <div
                  v-if="
                    !message.toolError &&
                    message.blockedPlanId &&
                    !chat.approvedPlans.value.has(message.blockedPlanId) &&
                    !chat.rejectedPlans.value.has(message.blockedPlanId)
                  "
                  class="workspace__msl-actions"
                >
                  <div class="workspace__msl-actions-row">
                    <q-icon name="warning" color="warning" size="18px" />
                    <span class="text-weight-medium">Freigabe erforderlich</span>
                  </div>
                  <div class="workspace__msl-actions-buttons q-mt-xs">
                    <q-btn
                      color="positive"
                      dense
                      no-caps
                      size="sm"
                      icon="check"
                      label="Freigeben"
                      :loading="chat.approving.value === message.blockedPlanId"
                      class="q-mr-sm"
                      @click="chat.approvePlan(message.blockedPlanId)"
                    />
                    <q-btn
                      color="negative"
                      dense
                      no-caps
                      size="sm"
                      outline
                      icon="close"
                      label="Ablehnen"
                      @click="chat.rejectPlan(message.blockedPlanId)"
                    />
                  </div>
                </div>

                <q-badge
                  v-else-if="
                    message.blockedPlanId && chat.approvedPlans.value.has(message.blockedPlanId)
                  "
                  color="positive"
                  icon="check_circle"
                  class="q-mt-xs"
                >
                  Freigegeben + angewendet
                </q-badge>

                <q-badge
                  v-else-if="
                    message.blockedPlanId && chat.rejectedPlans.value.has(message.blockedPlanId)
                  "
                  color="negative"
                  icon="block"
                  class="q-mt-xs"
                >
                  <template
                    v-if="
                      message.blockCategory === 'infeasibility' &&
                      message.blockedAggregateCount &&
                      message.blockedAggregateCount > 1
                    "
                  >
                    {{ message.blockedAggregateCount }}× Infeasible (strukturell nicht durchführbar)
                  </template>
                  <template v-else-if="message.blockCategory === 'infeasibility'">
                    Infeasible (strukturell nicht durchführbar)
                  </template>
                  <template v-else-if="message.blockCategory === 'risky'">
                    Von Policy abgelehnt (Risk/Approval)
                  </template>
                  <template v-else> Abgelehnt </template>
                </q-badge>
              </div>
            </template>
          </div>

          <div v-if="chat.sending.value" class="workspace__chat-loading">
            <q-spinner-dots size="24px" color="primary" />
            <span class="text-caption text-grey-6 q-ml-sm">LLM denkt nach...</span>
          </div>
        </div>
      </div>

      <!-- Study: Bewertungs-Button nach jeder Interaktion -->
      <div
        v-if="config.isStudyMode.value && study.phase.value === 'task'"
        class="workspace__study-actions"
      >
        <q-btn
          color="accent"
          no-caps
          dense
          icon="rate_review"
          label="Aufgabe bewerten"
          @click="study.openRatingsDialog()"
        />
      </div>

      <!-- Chat input -->
      <div class="workspace__input">
        <q-input
          v-model="chat.chatInput.value"
          type="textarea"
          autogrow
          dense
          outlined
          placeholder="Prompt eingeben... (Shift+Enter für Zeilenumbruch)"
          :disable="!selectedProject || chat.sending.value"
          autofocus
          input-class="workspace__input-textarea"
          @keydown="onPromptKeydown"
        >
          <template #append>
            <q-btn
              flat
              dense
              icon="send"
              color="primary"
              :disable="!chat.chatInput.value.trim() || !selectedProject || chat.sending.value"
              @click="chat.sendMessage()"
            />
          </template>
        </q-input>
      </div>
    </div>

    <!-- Study Dialoge (Overlays) -->
    <ConsentDialog
      v-if="config.isStudyMode.value"
      :visible="study.showConsentDialog.value"
      @accept="study.acceptConsent()"
    />

    <TaskDialog
      v-if="config.isStudyMode.value"
      :visible="study.showTaskDialog.value"
      :task="study.currentTask.value"
      :progress="study.progress.value"
      :has-started="studyTaskStarted"
      @start="onStudyTaskStart()"
      @close="study.showTaskDialog.value = false"
    />

    <RatingsDialog
      v-if="config.isStudyMode.value"
      :visible="study.showRatingsDialog.value"
      v-model:model-value="study.ratings.value"
      v-model:notes="study.ratingNotes.value"
      v-model:task-succeeded="study.taskSucceeded.value"
      :is-last="study.isLastTask.value"
      :submitting="submittingRatings"
      @submit="onStudySubmitRatings()"
      @back="study.showRatingsDialog.value = false"
    />

    <CompletionDialog
      v-if="config.isStudyMode.value"
      :visible="study.showCompletionDialog.value"
      v-model:sus-items="study.susItems.value"
      v-model:overall-trust="study.overallTrust.value"
      v-model:would-use="study.wouldUse.value"
      v-model:feedback="study.feedbackText.value"
      :submitting="submittingCompletion"
      @complete="onStudyComplete()"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useWorkspaceConfig } from 'src/composables/useWorkspaceConfig';
import { useWorkspaceChat } from 'src/composables/useWorkspaceChat';
import { useWorkspaceMsl } from 'src/composables/useWorkspaceMsl';
import { useWorkspaceStudy } from 'src/composables/useWorkspaceStudy';
import { StudyClient } from 'src/features/study/api';
import TopBar from 'src/components/workspace/TopBar.vue';
import ConsentDialog from 'src/components/workspace/ConsentDialog.vue';
import TaskDialog from 'src/components/workspace/TaskDialog.vue';
import RatingsDialog from 'src/components/workspace/RatingsDialog.vue';
import CompletionDialog from 'src/components/workspace/CompletionDialog.vue';
import type { ChatToolCallResult } from 'src/features/msl-client/api';
import { renderMarkdown } from 'src/utils/markdown';
import type { DiffEntry } from 'src/composables/useWorkspaceChat';

export default defineComponent({
  name: 'WorkspacePage',

  components: {
    TopBar,
    ConsentDialog,
    TaskDialog,
    RatingsDialog,
    CompletionDialog,
  },

  setup() {
    // === Config & Composables ===

    const config = useWorkspaceConfig();
    const selectedProject = ref<string | null>(config.projectIdFromUrl.value || null);
    const lowcoderMode = ref<'preview' | 'edit'>('preview');

    const chat = useWorkspaceChat(config.api, {
      getProjectId: () => selectedProject.value,
      getModel: () => config.modelFromUrl.value,
      getBackplaneBase: () => config.backplaneBase,
      onApplied: () => refreshLowcoder(),
    });

    const msl = useWorkspaceMsl(
      config.api,
      config.backplaneBase,
      chat.chatMessages,
      chat.approvedPlans,
      chat.seenPlanIds,
      { onNewPlan: () => chat.scrollToBottom() },
    );

    const study = useWorkspaceStudy();

    // Plan -> aktiver caseRunId, statt Zeitfenster-Matching (Polling/Stream-Latenz, Case-Folge)
    // Dedupe via linkedPlanIds, planIds global eindeutig
    const linkedPlanIds = new Set<string>();
    watch(
      () => chat.seenPlanIds.value.size,
      () => {
        const api = getStudyApi();
        if (!api || !activeCaseRunId) return;
        for (const planId of chat.seenPlanIds.value) {
          if (linkedPlanIds.has(planId)) continue;
          linkedPlanIds.add(planId);
          void api.linkPlan(activeCaseRunId, planId).catch(() => {
            linkedPlanIds.delete(planId);
          });
        }
      },
    );

    // StudyClient lazy nur im Study-Mode
    let studyApiInstance: StudyClient | null = null;
    function getStudyApi(): StudyClient | null {
      if (!studyApiInstance && config.isStudyMode.value) {
        studyApiInstance = new StudyClient(config.backplaneBase);
      }
      return studyApiInstance;
    }

    // === Resize ===

    const lowcoderWidth = ref(Math.round(window.innerWidth * 0.78));
    let resizing = false;

    function startResize() {
      resizing = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      const overlay = document.createElement('div');
      overlay.id = 'resize-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
      document.body.appendChild(overlay);
    }

    function handleMouseMove(event: MouseEvent) {
      if (!resizing) return;
      lowcoderWidth.value = Math.max(400, Math.min(event.clientX, window.innerWidth - 280));
    }

    function handleMouseUp() {
      if (!resizing) return;
      resizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.getElementById('resize-overlay')?.remove();
    }

    // === Projects ===

    const loadingProjects = ref(false);
    const projectOptions = ref<Array<{ label: string; value: string }>>([]);

    async function loadProjects() {
      loadingProjects.value = true;
      try {
        const projects = await config.api.getProjects();
        projectOptions.value = projects.map((project) => ({
          label: project.name || project.title || project.applicationId,
          value: project.applicationId,
        }));
      } catch (error) {
        console.warn('[workspace] Projekte konnten nicht geladen werden:', error);
      }
      loadingProjects.value = false;
    }

    function handleProjectSelection(projectId: string | null) {
      selectedProject.value = projectId;
    }

    function handleLowcoderModeChange(mode: 'preview' | 'edit') {
      lowcoderMode.value = mode;
    }

    // === Lowcoder iframe ===

    const lowcoderFrame = ref<HTMLIFrameElement | null>(null);

    const lowcoderUrl = computed(() => {
      if (!selectedProject.value) return '';
      return `${config.lowcoderBase}/apps/${selectedProject.value}/${lowcoderMode.value}`;
    });

    function refreshLowcoder() {
      if (lowcoderFrame.value) {
        const currentSource = lowcoderFrame.value.src;
        lowcoderFrame.value.src = currentSource;
      }
    }

    // === Clear Plans (free mode) ===
    // Backend: offene Pläne -> rejected; UI: nur Plan-Bubbles weg, Chat bleibt
    const clearingPlans = ref(false);
    async function clearAllPlans() {
      if (config.isStudyMode.value) return;
      const openCount = chat.chatMessages.value.filter(
        (m) =>
          m.blockedPlanId &&
          !chat.approvedPlans.value.has(m.blockedPlanId) &&
          !chat.rejectedPlans.value.has(m.blockedPlanId),
      ).length;
      const message =
        openCount > 0
          ? `${openCount} offene Pläne werden als rejected markiert. Fortfahren?`
          : 'Alle Plan-Bubbles aus dem Chat entfernen?';
      if (!window.confirm(message)) return;
      clearingPlans.value = true;
      try {
        await config.api.clearAllPlans('Manual cleanup via UI');
        chat.chatMessages.value = chat.chatMessages.value.filter((m) => !m.blockedPlanId);
        chat.approvedPlans.value.clear();
        chat.rejectedPlans.value.clear();
        chat.seenPlanIds.value.clear();
      } catch (error) {
        console.warn('[clear-plans] Fehler:', error);
      } finally {
        clearingPlans.value = false;
      }
    }

    // === MSL Presets ===

    async function setMslPreset(preset: 'off' | 'observe' | 'enforce') {
      const allGates = (mode: string) => ({
        policy: mode,
        preflight: mode,
        diff: mode,
        risk: mode,
        validation: mode,
        approval: mode,
        audit: mode,
      });

      const presetPatches: Record<string, Record<string, unknown>> = {
        off: { executionMode: 'auto', approvalRiskThreshold: 'high', gateModes: allGates('off') },
        observe: {
          executionMode: 'auto',
          approvalRiskThreshold: 'high',
          gateModes: { ...allGates('observe'), approval: 'off' },
        },
        enforce: {
          executionMode: 'manual',
          approvalRiskThreshold: 'medium',
          gateModes: allGates('enforce'),
        },
      };

      try {
        await config.api.updateConfig(
          presetPatches[preset] as Parameters<typeof config.api.updateConfig>[0],
        );
        await msl.loadMslStatus();
      } catch (error) {
        console.warn('[msl] Preset konnte nicht gesetzt werden:', error);
      }
    }

    // === Template helpers ===

    type MslMessage = {
      toolCalls?: ChatToolCallResult[];
      blockedPlanId?: string;
      riskLevel?: string;
      riskScore?: number;
      riskTags?: string[];
      diffHeadline?: string;
      diffSummary?: string[];
      diffEntries?: DiffEntry[];
      diffCounts?: { semantic: number; structural: number; metadata: number; total: number };
      riskReasons?: string[];
      policyViolations?: string[];
      validationWarnings?: string[];
      validationErrors?: string[];
      externalEndpoints?: string[];
      recommendations?: string[];
      approvalReasoning?: string;
      toolError?: string;
      blockCategory?: 'infeasibility' | 'risky';
      blockGate?: string;
      blockReason?: string;
      blockMissingRefs?: string[];
      blockSelfContradictions?: string[];
      blockViolations?: string[];
    };

    function mslBubbleClass(message: MslMessage): string {
      if (message.toolError) return 'workspace__bubble--msl-tool-error';
      if (
        message.blockedPlanId &&
        !chat.approvedPlans.value.has(message.blockedPlanId) &&
        !chat.rejectedPlans.value.has(message.blockedPlanId)
      )
        return 'workspace__bubble--msl-blocked';
      if (message.riskLevel === 'high') return 'workspace__bubble--msl-high';
      if (message.riskLevel === 'medium') return 'workspace__bubble--msl-medium';
      return 'workspace__bubble--msl-ok';
    }

    function getMslDecision(toolCall: ChatToolCallResult): string | undefined {
      const mslData = toolCall.msl;
      return typeof mslData?.decision === 'string' ? mslData.decision : undefined;
    }

    function riskLevelColor(level: string): string {
      if (level === 'high') return 'negative';
      if (level === 'medium') return 'warning';
      return 'positive';
    }

    function mslToolCalls(message: MslMessage): ChatToolCallResult[] {
      const existing = message.toolCalls ?? [];
      if (existing.length > 0) return existing;
      // Synthetischer Eintrag für polling-basierte Bubbles ohne Stream-Tool-Call.
      return [{ toolCallId: message.blockedPlanId ?? 'msl', toolName: '', args: {} }];
    }

    function mslApprovalState(
      message: MslMessage,
    ): 'pending' | 'approved' | 'rejected' | 'tool_error' | 'none' {
      // Tool-Fehler (Zod/Schema/Network) hat Vorrang, MSL nicht evaluiert -> weder approved noch rejected
      if (message.toolError) return 'tool_error';
      const planId = message.blockedPlanId;
      if (!planId) return 'none';
      if (chat.approvedPlans.value.has(planId)) return 'approved';
      if (chat.rejectedPlans.value.has(planId)) return 'rejected';
      return 'pending';
    }

    function mslStatusLabel(message: MslMessage): string {
      const state = mslApprovalState(message);
      if (state === 'pending') return 'Freigabe erforderlich';
      if (state === 'approved') return 'freigegeben';
      if (state === 'rejected') return 'abgelehnt';
      if (state === 'tool_error') return 'Tool-Fehler';
      return 'freigegeben';
    }

    function mslStatusIcon(message: MslMessage): string {
      const state = mslApprovalState(message);
      if (state === 'pending') return 'shield';
      if (state === 'rejected') return 'cancel';
      if (state === 'tool_error') return 'error';
      return 'check_circle';
    }

    function mslStatusColor(message: MslMessage): string {
      const state = mslApprovalState(message);
      if (state === 'pending') return 'warning';
      if (state === 'rejected') return 'negative';
      if (state === 'tool_error') return 'negative';
      return 'positive';
    }

    function isMslDetailsDefaultOpen(message: MslMessage): boolean {
      return mslApprovalState(message) === 'pending';
    }

    // Studien-Variante, 'full' = alles, Default ausserhalb Study-Mode
    const currentVariant = computed<'summary' | 'diff' | 'diff_risk' | 'full'>(() => {
      if (!config.isStudyMode.value) return 'full';
      const v = study.currentTask.value?.variant;
      return v ?? 'full';
    });

    function showDiffBlock(): boolean {
      return currentVariant.value !== 'summary';
    }
    function showRiskBadge(): boolean {
      return currentVariant.value === 'diff_risk' || currentVariant.value === 'full';
    }
    function showRiskTags(): boolean {
      return currentVariant.value === 'diff_risk' || currentVariant.value === 'full';
    }
    function showApprovalReasoning(): boolean {
      return currentVariant.value === 'diff_risk' || currentVariant.value === 'full';
    }
    // Details-Container (Diff + Tags + Reasoning) nur wenn mindestens eins sichtbar
    function showDetailsContainer(): boolean {
      return showDiffBlock() || showRiskTags() || showApprovalReasoning();
    }

    // verhindert leeren Details-Container
    function hasAnyMslContent(message: MslMessage): boolean {
      return !!(
        message.diffHeadline ||
        message.diffSummary?.length ||
        message.diffEntries?.length ||
        message.riskTags?.length ||
        message.approvalReasoning ||
        message.riskReasons?.length ||
        message.policyViolations?.length ||
        message.validationWarnings?.length ||
        message.validationErrors?.length ||
        message.externalEndpoints?.length ||
        message.recommendations?.length ||
        message.blockReason ||
        message.blockMissingRefs?.length ||
        message.blockSelfContradictions?.length ||
        message.blockViolations?.length
      );
    }

    function blockGateLabel(gate?: string): string {
      switch (gate) {
        case 'preflight':
          return 'Preflight';
        case 'policy':
          return 'Policy';
        case 'validation':
          return 'Validation';
        case 'approval':
          return 'Approval';
        case 'diff':
          return 'Diff';
        case 'risk':
          return 'Risk';
        case 'audit':
          return 'Audit';
        default:
          return gate ?? 'Gate';
      }
    }

    function onPromptKeydown(event: KeyboardEvent) {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        event.preventDefault();
        void chat.sendMessage();
      }
    }

    // === Study Flow ===

    const studyTaskStarted = ref(false);
    const submittingRatings = ref(false);
    const submittingCompletion = ref(false);
    let activeCaseRunId = '';

    async function initStudy() {
      const api = getStudyApi();
      if (!api || !config.studySessionId.value) return;

      try {
        const { session, caseRuns } = await api.getSession(config.studySessionId.value);

        const { tasks: liveTasks, designs } = await api.getLiveTasks();
        const designId = session.counterbalanceDesignId;

        type DisplayVariant = 'summary' | 'diff' | 'diff_risk';
        const VALID_VARIANTS: ReadonlySet<string> = new Set(['summary', 'diff', 'diff_risk']);
        const isDisplayVariant = (value: string): value is DisplayVariant =>
          VALID_VARIANTS.has(value);

        const resolveVariant = (caseId: string): DisplayVariant => {
          const matchingDesign = designs.find((design) => design.designId === designId);
          if (!matchingDesign) return 'diff_risk';
          for (const block of matchingDesign.blocks) {
            if (block.caseIds.includes(caseId) && isDisplayVariant(block.variant)) {
              return block.variant;
            }
          }
          return 'diff_risk';
        };

        const orderedTasks = session.caseSequence
          .map((id) => liveTasks.find((task) => task.caseId === id))
          .filter((task): task is NonNullable<typeof task> => task != null);

        study.setTasks(
          orderedTasks.map((task) => ({
            caseId: task.caseId,
            title: task.title,
            description: `${task.taskInstruction}\n\nKontext: ${task.context}`,
            variant: resolveVariant(task.caseId),
            examplePrompt: task.examplePrompt ?? '',
            ...(task.groundTruth ? { groundTruth: task.groundTruth } : {}),
          })),
        );

        const completedCount = caseRuns.filter((caseRun) => caseRun.status === 'completed').length;
        for (let skipIndex = 0; skipIndex < completedCount; skipIndex++) {
          study.nextTask();
        }

        if (config.projectIdFromUrl.value && !selectedProject.value) {
          selectedProject.value = config.projectIdFromUrl.value;
        } else if (!selectedProject.value) {
          await loadProjects();
          const firstProject = projectOptions.value[0];
          if (firstProject) {
            selectedProject.value = firstProject.value;
          }
        }
      } catch (error) {
        console.error('[study] Init fehlgeschlagen:', error);
      }
    }

    async function onStudyTaskStart() {
      study.startTask();
      studyTaskStarted.value = true;
      chat.reset();

      const api = getStudyApi();
      const currentSessionId = config.studySessionId.value;
      const currentTask = study.currentTask.value;
      if (!api || !currentSessionId || !currentTask) return;

      // MSL-Gates auf Variant setzen, vor Case-Start
      try {
        await api.setCaseConfig(currentTask.variant, currentSessionId);
      } catch (error) {
        console.warn('[study] MSL-Config konnte nicht gesetzt werden:', error);
      }

      try {
        const run = await api.createCaseRun(
          currentSessionId,
          currentTask.caseId,
          selectedProject.value || undefined,
        );
        activeCaseRunId = run.caseRunId;
      } catch (error) {
        console.warn('[study] CaseRun konnte nicht erstellt werden:', error);
      }
    }

    async function onStudySubmitRatings() {
      const api = getStudyApi();
      const sessionId = config.studySessionId.value;
      const currentTask = study.currentTask.value;
      if (!api || !sessionId || !currentTask) return;

      submittingRatings.value = true;
      try {
        const ratings = study.submitRatings();

        const chatHistory = chat.chatMessages.value.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.riskLevel
            ? { riskLevel: message.riskLevel, riskScore: message.riskScore }
            : {}),
          ...(message.blockedPlanId ? { blockedPlanId: message.blockedPlanId } : {}),
        }));

        // Decision-Quality: approved -> approve, nur rejected -> reject
        // nie blockiert (auto-applied) -> approve (impl. Vertrauen), sonst reject (impl. Ablehnung)
        // correct = decision vs groundTruth.decision
        const approvedCount = chat.approvedPlans.value.size;
        const rejectedCount = chat.rejectedPlans.value.size;
        const hadAnyBlock = chat.chatMessages.value.some((m) => !!m.blockedPlanId);
        let decision: 'approve' | 'reject';
        if (approvedCount > 0) decision = 'approve';
        else if (rejectedCount > 0) decision = 'reject';
        else if (!hadAnyBlock) decision = 'approve';
        else decision = 'reject';
        const expectedDecision = currentTask.groundTruth?.decision;
        const correct = expectedDecision ? decision === expectedDecision : undefined;

        await api.createResponse({
          studySessionId: sessionId,
          caseRunId: activeCaseRunId,
          caseId: currentTask.caseId,
          variant: currentTask.variant,
          decision,
          ...(correct !== undefined ? { correct } : {}),
          trustRating: ratings.trust,
          confidenceRating: ratings.confidence,
          transparencyRating: ratings.transparency,
          controlRating: ratings.control,
          decisionTimeMs: ratings.decisionTimeMs,
          ...(ratings.notes ? { notes: ratings.notes } : {}),
          additionalItems: {
            chatHistory,
            seenPlanIds: [...chat.seenPlanIds.value],
            approvedPlanIds: [...chat.approvedPlans.value],
            rejectedPlanIds: [...chat.rejectedPlans.value],
            groundTruthDecision: expectedDecision,
            // Selbsteinschätzung unabhängig von MSL-Decision (Fall: approved + applied, aber User unzufrieden)
            taskSucceeded: ratings.taskSucceeded,
          },
        });

        if (activeCaseRunId) {
          await api.updateCaseRun(activeCaseRunId, { status: 'completed' });
        }

        study.nextTask();
        studyTaskStarted.value = false;
        activeCaseRunId = '';
        chat.reset();
      } catch (error) {
        console.error('[study] Ratings konnten nicht gespeichert werden:', error);
      }
      submittingRatings.value = false;
    }

    async function onStudyComplete() {
      const api = getStudyApi();
      const sessionId = config.studySessionId.value;
      if (!api || !sessionId) return;

      submittingCompletion.value = true;
      try {
        const completion = study.getCompletionData();

        // SUS-Completion als extra Response, caseRunId per FK-Constraint nötig: aktiv -> letzter caseRun
        let postSessionCaseRunId = activeCaseRunId;
        if (!postSessionCaseRunId) {
          try {
            const { caseRuns } = await api.getSession(sessionId);
            postSessionCaseRunId = caseRuns[caseRuns.length - 1]?.caseRunId ?? '';
          } catch {
            // best-effort
          }
        }
        if (!postSessionCaseRunId) {
          console.error('[study] Kein case_run für SUS-Response, Abschluss nicht gespeichert.');
          submittingCompletion.value = false;
          return;
        }
        await api.createResponse({
          studySessionId: sessionId,
          caseRunId: postSessionCaseRunId,
          caseId: 'POST_SESSION',
          variant: 'diff_risk',
          additionalItems: {
            sus: completion.sus,
            overallTrust: completion.overallTrust,
            wouldUse: completion.wouldUse,
            feedback: completion.feedback,
          },
        });

        await api.updateSession(sessionId, {
          status: 'completed',
        });

        study.showCompletionDialog.value = false;
      } catch (error) {
        console.error('[study] Abschluss fehlgeschlagen:', error);
      }
      submittingCompletion.value = false;
    }

    // === Watch & Lifecycle ===

    watch(selectedProject, () => {
      if (selectedProject.value) {
        fetch(`${config.backplaneBase}/admin/context`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: selectedProject.value }),
        }).catch((error) =>
          console.warn('[workspace] Kontext konnte nicht gesetzt werden:', error),
        );
      }
    });

    let studyInitialized = false;
    watch(
      () => config.isStudyMode.value,
      (isStudy) => {
        if (isStudy && !studyInitialized) {
          studyInitialized = true;
          void initStudy();
        } else if (!isStudy && !studyInitialized) {
          void loadProjects();
        }
      },
      { immediate: true },
    );

    onMounted(() => {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    });

    return {
      config,
      chat,
      msl,
      study,
      selectedProject,
      lowcoderWidth,
      lowcoderMode,
      lowcoderFrame,
      lowcoderUrl,
      loadingProjects,
      projectOptions,
      studyTaskStarted,
      submittingRatings,
      submittingCompletion,
      startResize,
      refreshLowcoder,
      setMslPreset,
      clearingPlans,
      clearAllPlans,
      handleProjectSelection,
      handleLowcoderModeChange,
      onStudyTaskStart,
      onStudySubmitRatings,
      onStudyComplete,
      getMslDecision,
      mslBubbleClass,
      riskLevelColor,
      mslToolCalls,
      mslStatusLabel,
      mslStatusIcon,
      mslStatusColor,
      isMslDetailsDefaultOpen,
      onPromptKeydown,
      currentVariant,
      showDiffBlock,
      showRiskBadge,
      showRiskTags,
      showApprovalReasoning,
      showDetailsContainer,
      hasAnyMslContent,
      blockGateLabel,
      renderAssistantMarkdown: (text: string) => renderMarkdown(text ?? ''),
    };
  },
});
</script>

<style scoped lang="scss">
.workspace {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--msl-bg-sidebar);

  &__lowcoder {
    height: 100vh;
    flex-shrink: 0;
    position: relative;
  }

  &__iframe {
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
  }

  &__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: #f5f5f5;
  }

  &__handle {
    width: 6px;
    height: 100vh;
    background: var(--msl-bg-surface);
    cursor: col-resize;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
    z-index: 10;

    &:hover {
      background: #4a4a6a;
    }
  }

  &__handle-dots {
    display: flex;
    flex-direction: column;
    gap: 3px;

    div {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--msl-text-secondary);
    }
  }

  &__sidebar {
    flex: 1;
    min-width: 280px;
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--msl-blue-900);
    color: var(--msl-text-primary);
  }

  &__chat {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column-reverse; // anchor scroll to bottom
  }

  &__chat-inner {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__chat-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    opacity: 0.5;
  }

  &__chat-message {
    margin-bottom: 8px;
  }

  &__chat-loading {
    display: flex;
    align-items: center;
    padding: 8px;
  }

  &__bubble {
    padding: 8px 12px;
    border-radius: 12px;
    font-size: 13px;
    line-height: 1.4;
    word-break: break-word;
    max-width: 100%;

    &--user {
      background: var(--msl-blue-700);
      color: white;
      border-bottom-right-radius: 4px;
    }

    &--assistant {
      background: var(--msl-bg-surface);
      color: var(--msl-text-primary);
      border-bottom-left-radius: 4px;
    }

    &--msl {
      background: #1b3a2a;
      color: #c8e6c9;
      border: 1px solid var(--msl-color-approved);
      border-bottom-left-radius: 4px;
    }
  }

  &__msl-toolcall {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  &__msl-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    padding: 2px 0;
  }

  &__msl-risk-badge {
    margin-left: auto;
  }

  &__msl-tool-name {
    font-size: 11px;
    background: rgba(255, 255, 255, 0.12);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: monospace;
  }

  &__msl-tool-status {
    font-size: 11px;
    opacity: 0.75;
  }

  &__msl-section {
    width: 100%;
    background: rgba(0, 0, 0, 0.18);
    border-radius: 4px;
    overflow: hidden;

    :deep(.q-expansion-item__container) {
      width: 100%;
    }

    :deep(.q-item) {
      min-height: 22px;
      padding: 0 8px;
    }

    :deep(.q-item__section--avatar) {
      min-width: 20px;
      padding-right: 4px;

      .q-icon {
        font-size: 14px;
      }
    }

    :deep(.q-item__label) {
      font-size: 11px;
      line-height: 1.2;
      opacity: 0.8;
    }

    :deep(.q-expansion-item__content) {
      padding: 6px 8px;
      background: rgba(0, 0, 0, 0.15);
    }
  }

  &__msl-section-header {
    min-height: 22px !important;
    padding: 0 8px !important;
  }

  &__msl-args-pre {
    font-size: 10px;
    line-height: 1.3;
    margin: 0;
    padding: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: #c8e6c9;
  }

  &__msl-empty {
    font-size: 10px;
    opacity: 0.55;
    font-style: italic;
  }

  &__msl-block-reason {
    margin: 0 0 10px 0;
    padding: 8px 10px;
    border-left: 3px solid #f44336;
    background: rgba(244, 67, 54, 0.07);
    border-radius: 0 3px 3px 0;
  }

  &__msl-block-reason-header {
    display: flex;
    align-items: center;
    font-size: 11px;
    margin-bottom: 6px;
    gap: 4px;
  }

  &__msl-block-reason-text {
    font-size: 11px;
    opacity: 0.92;
    line-height: 1.5;
    margin-bottom: 6px;
    word-break: break-word;
    white-space: normal;
    font-family: inherit;
  }

  &__msl-block-list {
    margin-top: 6px;
    font-size: 11px;

    > .text-caption {
      display: block;
      margin-bottom: 2px;
      opacity: 0.75;
    }

    ul {
      margin: 0;
      padding-left: 18px;
      line-height: 1.5;
    }

    li {
      margin: 1px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      word-break: break-word;
    }
  }

  &__bubble--markdown {
    p {
      margin: 0 0 6px 0;
    }
    p:last-child {
      margin-bottom: 0;
    }
    h4,
    h5,
    h6 {
      margin: 6px 0 4px 0;
      font-weight: 600;
    }
    h4 {
      font-size: 14px;
    }
    h5 {
      font-size: 13px;
    }
    h6 {
      font-size: 12px;
    }
    ul,
    ol {
      margin: 4px 0;
      padding-left: 20px;
    }
    li {
      margin: 2px 0;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.9em;
      background: rgba(255, 255, 255, 0.08);
      padding: 1px 4px;
      border-radius: 3px;
    }
    strong {
      font-weight: 600;
    }
    em {
      font-style: italic;
    }
    a {
      color: #4fa3ff;
      text-decoration: underline;
    }
  }

  &__msl-diff {
    margin: 0;
    padding: 0;
  }

  &__msl-diff-entries {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  &__msl-diff-entry {
    border-left: 2px solid rgba(255, 255, 255, 0.15);
    padding: 4px 0 4px 8px;
  }

  &__msl-diff-entry-headline {
    font-size: 11px;
    font-weight: 500;
    opacity: 0.95;
    margin-bottom: 4px;
    word-break: break-word;
  }

  &__msl-diff-value {
    margin-top: 3px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  &__msl-diff-value-label {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.55;
  }

  &__msl-diff-value--old &__msl-diff-value-label {
    color: #ef9a9a;
  }

  &__msl-diff-value--new &__msl-diff-value-label {
    color: #a5d6a7;
  }

  &__msl-diff-value-pre {
    margin: 0;
    padding: 4px 6px;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
  }

  &__msl-diff-value--old &__msl-diff-value-pre {
    border-left: 2px solid rgba(239, 154, 154, 0.4);
  }

  &__msl-diff-value--new &__msl-diff-value-pre {
    border-left: 2px solid rgba(165, 214, 167, 0.4);
  }

  &__msl-diff-value-inline {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 5px;
    border-radius: 3px;
    word-break: break-word;
  }

  &__msl-diff-value--empty &__msl-diff-value-inline {
    opacity: 0.65;
    font-style: italic;
  }

  &__msl-rsection {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 3px;
    border-left: 2px solid rgba(255, 255, 255, 0.2);
    font-size: 11px;
    line-height: 1.45;

    ul {
      margin: 2px 0 0 0;
      padding-left: 16px;
    }
    li {
      margin: 1px 0;
      word-break: break-word;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      background: rgba(255, 255, 255, 0.05);
      padding: 0 3px;
      border-radius: 2px;
    }
  }

  &__msl-rsection-title {
    display: flex;
    align-items: center;
    font-weight: 500;
    font-size: 11px;
    margin-bottom: 2px;
    opacity: 0.9;
  }

  &__msl-rsection--reasons {
    background: rgba(255, 255, 255, 0.03);
    border-left-color: #90caf9;
  }
  &__msl-rsection--errors {
    background: rgba(244, 67, 54, 0.08);
    border-left-color: #ef5350;
  }
  &__msl-rsection--warnings {
    background: rgba(255, 193, 7, 0.08);
    border-left-color: #ffb74d;
  }
  &__msl-rsection--external {
    background: rgba(255, 152, 0, 0.07);
    border-left-color: #ffa726;
  }
  &__msl-rsection--recommendations {
    background: rgba(33, 150, 243, 0.07);
    border-left-color: #64b5f6;
  }

  &__msl-diff-header {
    display: flex;
    align-items: center;
    font-size: 11px;
  }

  &__msl-diff-counts {
    opacity: 0.7;
  }

  &__msl-diff-headline {
    font-size: 11px;
    opacity: 0.9;
    margin-top: 3px;
  }

  &__msl-diff-list {
    margin: 4px 0 0 0;
    padding-left: 18px;
    font-size: 11px;
    line-height: 1.4;

    li {
      margin-bottom: 2px;
    }
  }

  &__msl-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  &__msl-tag {
    font-size: 10px;
  }

  &__msl-reasoning {
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    opacity: 0.85;
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  &__msl-actions {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  &__msl-actions-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }

  &__msl-actions-buttons {
    display: flex;
    gap: 8px;
  }

  &__bubble--msl-ok {
    border-left: 3px solid var(--msl-color-approved, #4caf50);
  }

  &__bubble--msl-medium {
    border-left: 3px solid #ff9800;
  }

  &__bubble--msl-high {
    border-left: 3px solid #f44336;
  }

  &__bubble--msl-blocked {
    border-left: 3px solid #f44336;
    background: #2a1515 !important;
  }

  &__bubble--msl-tool-error {
    border-left: 3px solid #f44336;
    background: #3a1e1e !important;
  }

  &__msl-tool-error-badge {
    max-width: 100%;
    white-space: normal;
    word-break: break-word;
  }

  &__study-actions {
    padding: 6px 8px;
    border-top: 1px solid var(--msl-bg-surface);
    text-align: center;
  }

  &__input {
    padding: 8px;
    border-top: 1px solid var(--msl-bg-surface);
    background: var(--msl-bg-sidebar);

    :deep(.q-field__control) {
      background: var(--msl-bg-surface);
      color: var(--msl-text-primary);
    }

    :deep(.q-field__native) {
      color: var(--msl-text-primary);
    }
  }
}
</style>
