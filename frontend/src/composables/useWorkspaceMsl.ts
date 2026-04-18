import { ref, onMounted, onBeforeUnmount } from 'vue';
import type { MslClient } from 'src/features/msl-client/api';
import type { ChatMessage, DiffEntry } from './useWorkspaceChat';

export function useWorkspaceMsl(
  client: MslClient,
  backplaneBase: string,
  chatMessages: { value: ChatMessage[] },
  approvedPlans: { value: Set<string> },
  seenPlanIds: { value: Set<string> },
  options?: { onNewPlan?: () => void },
) {
  const mslStatus = ref('');
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function loadMslStatus() {
    try {
      const config = await client.getConfig();
      const gateModes = config.msl?.gateModes ?? {};
      const hasEnforce = Object.values(gateModes).some((mode) => mode === 'enforce');
      const hasObserve = Object.values(gateModes).some((mode) => mode === 'observe');
      mslStatus.value = hasEnforce ? 'ENFORCE' : hasObserve ? 'OBSERVE' : 'OFF';
    } catch {
      mslStatus.value = '';
    }
  }

  async function pollForPlans() {
    try {
      // Globale Queue ohne actorId-Filter, dedupe per planId weiter unten
      const endpoint = `${backplaneBase}/admin/queue`;
      const response = await fetch(endpoint);
      if (!response.ok) return;

      const data = await response.json();
      const openPlans = (data.openPlans ?? []) as Array<Record<string, unknown>>;

      for (const plan of openPlans) {
        const planId = plan.planId as string;
        if (!planId) continue;
        seenPlanIds.value.add(planId);
        if (approvedPlans.value.has(planId)) continue;

        // dedupe gegen bereits gerenderte Bubbles
        const alreadyShown = chatMessages.value.some((message) => message.blockedPlanId === planId);
        if (alreadyShown) continue;

        const risk = plan.risk as Record<string, unknown> | undefined;
        const diff = plan.diff as Record<string, unknown> | undefined;
        const structuralDiff =
          diff && typeof diff.structuralDiff === 'object' && diff.structuralDiff !== null
            ? (diff.structuralDiff as Record<string, unknown>)
            : undefined;
        const mcpCall = plan.mcpCall as { name: string; args: Record<string, unknown> } | undefined;
        if (!mcpCall) {
          // Alt-Plans ohne mcpCall ignorieren
          continue;
        }
        const toolName = mcpCall.name;
        const args = mcpCall.args;

        // diff-Entries für Vorher-Nachher-Boxen vor Approve
        const diffEntries: DiffEntry[] | undefined =
          structuralDiff && Array.isArray(structuralDiff.humanEntries)
            ? (structuralDiff.humanEntries as unknown[])
                .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
                .map((e) => ({
                  headline: typeof e.headline === 'string' ? e.headline : '',
                  kind: typeof e.kind === 'string' ? (e.kind as DiffEntry['kind']) : 'generic',
                  path: typeof e.path === 'string' ? e.path : '',
                  category:
                    e.category === 'structural' || e.category === 'semantic'
                      ? e.category
                      : 'semantic',
                  ...(typeof e.subjectName === 'string' ? { subjectName: e.subjectName } : {}),
                  ...(typeof e.propertyName === 'string' ? { propertyName: e.propertyName } : {}),
                  ...(typeof e.oldValue === 'string' ? { oldValue: e.oldValue } : {}),
                  ...(typeof e.newValue === 'string' ? { newValue: e.newValue } : {}),
                  ...(typeof e.multiline === 'boolean' ? { multiline: e.multiline } : {}),
                }))
            : undefined;

        // strukturierte Reasoning-Sektionen, parallel zu approvalReasoning
        const structured =
          plan.approvalReasoningStructured && typeof plan.approvalReasoningStructured === 'object'
            ? (plan.approvalReasoningStructured as Record<string, unknown>)
            : undefined;
        const pickStringArr = (v: unknown): string[] | undefined =>
          Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : undefined;

        chatMessages.value.push({
          role: 'msl',
          content: toolName,
          toolCalls: [
            {
              toolCallId: planId,
              toolName,
              args,
            },
          ],
          blockedPlanId: planId,
          ...(typeof risk?.level === 'string' ? { riskLevel: risk.level } : {}),
          ...(typeof risk?.score === 'number' ? { riskScore: risk.score } : {}),
          ...(Array.isArray(risk?.tags) ? { riskTags: risk.tags as string[] } : {}),
          ...(typeof diff?.diffSummary === 'string' ? { diffHeadline: diff.diffSummary } : {}),
          ...(Array.isArray(structuralDiff?.humanSummary)
            ? { diffSummary: structuralDiff.humanSummary as string[] }
            : {}),
          ...(structuralDiff &&
          typeof structuralDiff.counts === 'object' &&
          structuralDiff.counts !== null
            ? { diffCounts: structuralDiff.counts as NonNullable<ChatMessage['diffCounts']> }
            : {}),
          ...(diffEntries && diffEntries.length > 0 ? { diffEntries } : {}),
          ...(typeof plan.approvalReasoning === 'string'
            ? { approvalReasoning: plan.approvalReasoning }
            : {}),
          ...(structured
            ? {
                ...(pickStringArr(structured.reasons)
                  ? { riskReasons: pickStringArr(structured.reasons)! }
                  : {}),
                ...(pickStringArr(structured.policyViolations)
                  ? { policyViolations: pickStringArr(structured.policyViolations)! }
                  : {}),
                ...(pickStringArr(structured.warnings)
                  ? { validationWarnings: pickStringArr(structured.warnings)! }
                  : {}),
                ...(pickStringArr(structured.errors)
                  ? { validationErrors: pickStringArr(structured.errors)! }
                  : {}),
                ...(pickStringArr(structured.externalEndpoints)
                  ? { externalEndpoints: pickStringArr(structured.externalEndpoints)! }
                  : {}),
                ...(pickStringArr(structured.recommendations)
                  ? { recommendations: pickStringArr(structured.recommendations)! }
                  : {}),
              }
            : {}),
        });
        options?.onNewPlan?.();
      }
    } catch {
      // PollingFehler nicht propagaten
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      void pollForPlans();
    }, 2000);
    void pollForPlans();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  onMounted(() => {
    void loadMslStatus();
    startPolling();
  });

  onBeforeUnmount(() => {
    stopPolling();
  });

  return {
    mslStatus,
    loadMslStatus,
    startPolling,
    stopPolling,
  };
}
