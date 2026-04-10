// Chat-Composable streamt LLM-Antworten über Vercel AI SDK v6
import { ref, computed, nextTick } from 'vue';

export interface ChatToolCallResult {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  msl?: Record<string, unknown>;
  error?: string;
  result?: Record<string, unknown>;
}

// Diff-Entry vom Backend (StructuralDiffResult.humanEntries)
export interface DiffEntry {
  headline: string;
  kind:
    | 'component'
    | 'property'
    | 'event'
    | 'query'
    | 'rename'
    | 'tempState'
    | 'preload'
    | 'generic';
  subjectName?: string;
  propertyName?: string;
  oldValue?: string;
  newValue?: string;
  multiline?: boolean;
  path: string;
  category: 'semantic' | 'structural';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'msl';
  content: string;
  toolCalls?: ChatToolCallResult[];
  blockedPlanId?: string;
  riskLevel?: string;
  riskScore?: number;
  riskTags?: string[];
  approvalReasoning?: string;
  riskReasons?: string[];
  policyViolations?: string[];
  validationWarnings?: string[];
  validationErrors?: string[];
  externalEndpoints?: string[];
  recommendations?: string[];
  diffHeadline?: string;
  diffSummary?: string[];
  diffEntries?: DiffEntry[];
  diffCounts?: { semantic: number; structural: number; metadata: number; total: number };
  mode?: string;
  applied?: boolean;
  // Gate-Kategorie: infeasibility ist strukturell, risky ist UserEntscheidung
  blockCategory?: 'infeasibility' | 'risky';
  blockGate?: string;
  blockReason?: string;
  // fehlende Komponenten-IDs aus Preflight
  blockMissingRefs?: string[];
  blockSelfContradictions?: string[];
  // Verletzte Regeln aus Policy und Validation
  blockViolations?: string[];
  // Fehler vor dem Gate-Stack, z.B. Zod, Schema, Network
  toolError?: string;
  // Aggregation hart-geblockter Folgecalls desselben Tools
  blockedAggregateCount?: number;
  blockedAggregatePlanIds?: string[];
}

// UIMessageChunk-Subset aus ai@6 nur die im Frontend genutzten Varianten
type StreamChunk =
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-output-available'; toolCallId: string; output: unknown }
  | { type: 'tool-output-error'; toolCallId: string; errorText: string }
  | { type: 'error'; errorText: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): Record<string, unknown> {
  try {
    const start = text.indexOf('{');
    if (start < 0) return {};
    return JSON.parse(text.slice(start)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// MCP-Tool-Result hat Shape { content, structuredContent, isError }
function unwrapEnvelope(toolResult: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(toolResult.structuredContent)) return toolResult.structuredContent;
  if (Array.isArray(toolResult.content)) {
    const textBlock = (toolResult.content as Array<Record<string, unknown>>).find(
      (block) => block.type === 'text',
    );
    const text = typeof textBlock?.text === 'string' ? textBlock.text : '';
    const parsed = tryParseJson(text);
    if (Object.keys(parsed).length > 0) return parsed;
  }
  return toolResult;
}

function pickMslData(envelope: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = isRecord(envelope.data) ? envelope.data : undefined;
  if (isRecord(data?.msl)) return data.msl;
  const error = isRecord(envelope.error) ? envelope.error : undefined;
  const details = isRecord(error?.details) ? error.details : undefined;
  if (isRecord(details?.mslPayload)) return details.mslPayload;
  if (isRecord(envelope.msl)) return envelope.msl;
  return undefined;
}

function pickErrorMessage(envelope: Record<string, unknown>): string | undefined {
  if (envelope.ok === false && typeof envelope.message === 'string') return envelope.message;
  if (typeof envelope.error === 'string') return envelope.error;
  if (envelope.error) return JSON.stringify(envelope.error);
  if (envelope.isError) return JSON.stringify(envelope);
  return undefined;
}

function extractMslFields(toolResult: Record<string, unknown>): {
  mslData: Record<string, unknown> | undefined;
  errorMessage: string | undefined;
} {
  const envelope = unwrapEnvelope(toolResult);
  return { mslData: pickMslData(envelope), errorMessage: pickErrorMessage(envelope) };
}

function buildMslMessage(toolCall: ChatToolCallResult): ChatMessage {
  let blockedPlanId: string | undefined;
  let riskLevel: string | undefined;
  let riskScore: number | undefined;
  let riskTags: string[] | undefined;
  let approvalReasoning: string | undefined;
  let riskReasons: string[] | undefined;
  let policyViolations: string[] | undefined;
  let validationWarnings: string[] | undefined;
  let validationErrors: string[] | undefined;
  let externalEndpoints: string[] | undefined;
  let recommendations: string[] | undefined;
  let blockCategory: 'infeasibility' | 'risky' | undefined;
  let blockGate: string | undefined;
  let blockReason: string | undefined;
  let blockMissingRefs: string[] | undefined;
  let blockSelfContradictions: string[] | undefined;
  let blockViolations: string[] | undefined;

  let diffHeadline: string | undefined;
  let diffSummary: string[] | undefined;
  let diffEntries: DiffEntry[] | undefined;
  let diffCounts: ChatMessage['diffCounts'];
  let mode: string | undefined;
  let applied: boolean | undefined;

  if (toolCall.msl) {
    const decision = typeof toolCall.msl.decision === 'string' ? toolCall.msl.decision : undefined;
    const isBlocked = decision === 'blocked' || decision === 'rejected';
    if (isBlocked && typeof toolCall.msl.planId === 'string') {
      blockedPlanId = toolCall.msl.planId;
    }
    // blockierendes Gate aus Payload, Infeasibility hat Vorrang vor Approval
    const gatesRaw = toolCall.msl.gates;
    if (Array.isArray(gatesRaw)) {
      const gates = gatesRaw.filter(
        (g): g is Record<string, unknown> => isRecord(g) && g.blocked === true,
      );
      const blockingGate = gates.find((g) => g.category === 'infeasibility') ?? gates[0];
      const cat = blockingGate?.category;
      if (cat === 'infeasibility' || cat === 'risky') {
        blockCategory = cat;
      }
      if (blockingGate) {
        if (typeof blockingGate.gate === 'string') blockGate = blockingGate.gate;
        if (typeof blockingGate.reason === 'string') blockReason = blockingGate.reason;
        const details = isRecord(blockingGate.details) ? blockingGate.details : undefined;
        if (details) {
          const missing = details.missingEntityRefs;
          if (Array.isArray(missing) && missing.every((e) => typeof e === 'string')) {
            blockMissingRefs = missing;
          }
          const collisions = details.selfContradictions;
          if (Array.isArray(collisions) && collisions.every((e) => typeof e === 'string')) {
            blockSelfContradictions = collisions;
          }
          const violations = details.violations ?? details.errors;
          if (Array.isArray(violations) && violations.every((e) => typeof e === 'string')) {
            blockViolations = violations;
          }
        }
      }
    }
    const risk = isRecord(toolCall.msl.risk) ? toolCall.msl.risk : undefined;
    if (risk) {
      if (typeof risk.level === 'string') riskLevel = risk.level;
      if (typeof risk.score === 'number') riskScore = risk.score;
      if (Array.isArray(risk.tags)) riskTags = risk.tags as string[];
    }
    if (typeof toolCall.msl.approvalReasoning === 'string') {
      approvalReasoning = toolCall.msl.approvalReasoning;
    }
    // strukturierte Begründung bevorzugen, erlaubt getrenntes Rendering
    const structured = isRecord(toolCall.msl.approvalReasoningStructured)
      ? toolCall.msl.approvalReasoningStructured
      : undefined;
    if (structured) {
      if (
        Array.isArray(structured.reasons) &&
        structured.reasons.every((e) => typeof e === 'string')
      ) {
        riskReasons = structured.reasons;
      }
      if (
        Array.isArray(structured.policyViolations) &&
        structured.policyViolations.every((e) => typeof e === 'string')
      ) {
        policyViolations = structured.policyViolations;
      }
      if (
        Array.isArray(structured.warnings) &&
        structured.warnings.every((e) => typeof e === 'string')
      ) {
        validationWarnings = structured.warnings;
      }
      if (
        Array.isArray(structured.errors) &&
        structured.errors.every((e) => typeof e === 'string')
      ) {
        validationErrors = structured.errors;
      }
      if (
        Array.isArray(structured.externalEndpoints) &&
        structured.externalEndpoints.every((e) => typeof e === 'string')
      ) {
        externalEndpoints = structured.externalEndpoints;
      }
      if (
        Array.isArray(structured.recommendations) &&
        structured.recommendations.every((e) => typeof e === 'string')
      ) {
        recommendations = structured.recommendations;
      }
    }
    const diff = isRecord(toolCall.msl.diff) ? toolCall.msl.diff : undefined;
    if (diff) {
      if (typeof diff.diffSummary === 'string') {
        diffHeadline = diff.diffSummary;
      }
      const structural = isRecord(diff.structuralDiff) ? diff.structuralDiff : undefined;
      if (structural) {
        if (Array.isArray(structural.humanSummary)) {
          diffSummary = structural.humanSummary as string[];
        }
        if (Array.isArray(structural.humanEntries)) {
          diffEntries = (structural.humanEntries as unknown[])
            .filter((e): e is Record<string, unknown> => isRecord(e))
            .map((e) => e as unknown as DiffEntry);
        }
        if (isRecord(structural.counts)) {
          diffCounts = structural.counts as ChatMessage['diffCounts'];
        }
      }
    }
  }

  if (toolCall.result) {
    if (typeof toolCall.result.mode === 'string') mode = toolCall.result.mode;
    if (typeof toolCall.result.applied === 'boolean') applied = toolCall.result.applied;
    const data = isRecord(toolCall.result.data) ? toolCall.result.data : undefined;
    if (data) {
      if (typeof data.mode === 'string' && !mode) mode = data.mode;
      if (typeof data.applied === 'boolean' && applied === undefined) applied = data.applied;
    }
  }

  // Tool-Fehler nur wenn MSL gar nicht evaluiert hat (Zod, Schema, Transport)
  const mslDecision =
    typeof toolCall.msl?.decision === 'string' ? toolCall.msl.decision : undefined;
  const mslEvaluated = !!mslDecision && mslDecision !== 'not_evaluated';
  const hasToolError = !!toolCall.error && !mslEvaluated;

  return {
    role: 'msl',
    content: toolCall.toolName,
    toolCalls: [toolCall],
    ...(blockedPlanId ? { blockedPlanId } : {}),
    ...(blockCategory ? { blockCategory } : {}),
    ...(blockGate ? { blockGate } : {}),
    ...(blockReason ? { blockReason } : {}),
    ...(blockMissingRefs?.length ? { blockMissingRefs } : {}),
    ...(blockSelfContradictions?.length ? { blockSelfContradictions } : {}),
    ...(blockViolations?.length ? { blockViolations } : {}),
    ...(hasToolError ? { toolError: toolCall.error } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(riskScore != null ? { riskScore } : {}),
    ...(riskTags ? { riskTags } : {}),
    ...(approvalReasoning ? { approvalReasoning } : {}),
    ...(riskReasons?.length ? { riskReasons } : {}),
    ...(policyViolations?.length ? { policyViolations } : {}),
    ...(validationWarnings?.length ? { validationWarnings } : {}),
    ...(validationErrors?.length ? { validationErrors } : {}),
    ...(externalEndpoints?.length ? { externalEndpoints } : {}),
    ...(recommendations?.length ? { recommendations } : {}),
    ...(diffHeadline ? { diffHeadline } : {}),
    ...(diffSummary?.length ? { diffSummary } : {}),
    ...(diffEntries?.length ? { diffEntries } : {}),
    ...(diffCounts ? { diffCounts } : {}),
    ...(mode ? { mode } : {}),
    ...(applied !== undefined ? { applied } : {}),
  };
}

export function useWorkspaceChat(
  _client: unknown,
  callbacks: {
    getProjectId: () => string | null;
    getModel: () => string;
    getBackplaneBase: () => string;
    onApplied?: () => void;
  },
) {
  const chatMessages = ref<ChatMessage[]>([]);
  const chatInput = ref('');
  const sending = ref(false);
  const approving = ref('');
  const approvedPlans = ref(new Set<string>());
  const rejectedPlans = ref(new Set<string>());
  // alle gesehenen Plans (approve/reject/block egal), Trigger für api.linkPlan im WorkspacePage-Watcher
  // statt Zeitfenster-Matching, Plan-Case-Zuordnung ist deterministisch über aktiven Case
  const seenPlanIds = ref(new Set<string>());
  const chatContainer = ref<HTMLElement | null>(null);
  // /admin/chat-Stream, abort bei reset() sonst Tool-Calls vom alten Case auf neuen
  let activeStreamController: AbortController | null = null;

  const chatHistory = computed(() =>
    chatMessages.value
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, content: message.content })),
  );

  function scrollToBottom() {
    void nextTick(() => {
      if (chatContainer.value) {
        chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
      }
    });
  }

  async function sendMessage() {
    const messageText = chatInput.value.trim();
    const projectId = callbacks.getProjectId();
    const backplaneBase = callbacks.getBackplaneBase();
    if (!messageText || !projectId || sending.value) return;

    chatMessages.value.push({ role: 'user', content: messageText });
    chatInput.value = '';
    sending.value = true;
    scrollToBottom();

    let streamedText = '';
    const pendingToolCalls = new Map<string, ChatToolCallResult>();
    let hasAppliedOps = false;

    // defensiv gegen RaceCondition bei schnellem Case-Wechsel reset() sollte schon aborted haben
    if (activeStreamController) {
      activeStreamController.abort();
    }
    const controller = new AbortController();
    activeStreamController = controller;

    try {
      const response = await fetch(`${backplaneBase}/admin/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          projectId,
          model: callbacks.getModel(),
          history: chatHistory.value,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => response.statusText);
        chatMessages.value.push({ role: 'assistant', content: `Fehler: ${errorText}` });
        sending.value = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const textMessageIndex = chatMessages.value.length;
      chatMessages.value.push({ role: 'assistant', content: '' });

      // SSE: Frames per \n\n getrennt, data:-Zeile = UIMessageChunk-JSON, [DONE] = Stream-Ende
      const handleChunk = (chunk: StreamChunk) => {
        switch (chunk.type) {
          case 'text-delta': {
            const delta = typeof chunk.delta === 'string' ? chunk.delta : '';
            if (!delta) break;
            streamedText += delta;
            chatMessages.value[textMessageIndex] = { role: 'assistant', content: streamedText };
            scrollToBottom();
            break;
          }
          case 'tool-input-available': {
            const input = isRecord(chunk.input) ? chunk.input : {};
            pendingToolCalls.set(chunk.toolCallId, {
              toolCallId: chunk.toolCallId,
              toolName: chunk.toolName,
              args: input,
            });
            break;
          }
          case 'tool-output-available': {
            const pending = pendingToolCalls.get(chunk.toolCallId);
            if (!pending) break;
            const resultRecord = isRecord(chunk.output) ? chunk.output : {};

            const { mslData, errorMessage } = extractMslFields(resultRecord);
            if (mslData) pending.msl = mslData;
            if (errorMessage) pending.error = errorMessage;
            if (!mslData && !errorMessage) pending.result = { applied: true };

            // Hard-Block: infeasibility und risky-im-auto-mode bekommen keine Buttons
            // Aggregation nur für infeasibility, risky bleibt einzeln sichtbar
            const decision = mslData?.decision?.toString() ?? '';
            const isHardBlocked = decision === 'blocked';
            const planId = typeof mslData?.planId === 'string' ? mslData.planId : undefined;
            if (isHardBlocked && planId) {
              rejectedPlans.value.add(planId);
            }
            if (planId) seenPlanIds.value.add(planId);
            const streamBubble = buildMslMessage(pending);
            const isInfeasibility = streamBubble.blockCategory === 'infeasibility';

            const existingIndex = planId
              ? chatMessages.value.findIndex((m) => m.blockedPlanId === planId)
              : -1;
            if (existingIndex >= 0) {
              chatMessages.value[existingIndex] = streamBubble;
            } else if (isHardBlocked && isInfeasibility && chatMessages.value.length > 0) {
              const last = chatMessages.value[chatMessages.value.length - 1];
              if (
                last?.role === 'msl' &&
                last.content === streamBubble.content &&
                last.blockCategory === 'infeasibility' &&
                last.blockedPlanId &&
                rejectedPlans.value.has(last.blockedPlanId)
              ) {
                const prevCount = last.blockedAggregateCount ?? 1;
                last.blockedAggregateCount = prevCount + 1;
                if (planId) {
                  last.blockedAggregatePlanIds = [
                    ...(last.blockedAggregatePlanIds ?? [last.blockedPlanId]),
                    planId,
                  ];
                }
              } else {
                chatMessages.value.push(streamBubble);
              }
            } else {
              chatMessages.value.push(streamBubble);
            }
            scrollToBottom();

            if (!pending.error && !decision.match(/blocked|rejected/)) {
              hasAppliedOps = true;
            }
            break;
          }
          case 'tool-output-error': {
            const pending = pendingToolCalls.get(chunk.toolCallId);
            if (!pending) break;
            pending.error = chunk.errorText ?? 'Tool error';
            const streamBubble = buildMslMessage(pending);
            chatMessages.value.push(streamBubble);
            scrollToBottom();
            break;
          }
          case 'error': {
            const errStr = chunk.errorText ?? 'Unknown error';
            streamedText += `\n\nFehler: ${errStr}`;
            chatMessages.value[textMessageIndex] = { role: 'assistant', content: streamedText };
            break;
          }
          // andere Chunks bewusst ignoriert
        }
      };

      const processFrame = (frame: string) => {
        // Frame kann mehrere data-Zeilen haben - Rest ignorieren
        for (const rawLine of frame.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const raw = JSON.parse(payload) as unknown;
            if (isRecord(raw) && typeof raw.type === 'string') {
              handleChunk(raw as unknown as StreamChunk);
            }
          } catch {
            // kaputter Frame
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const normalized = buffer.replace(/\r\n/g, '\n');
        const frames = normalized.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.trim()) continue;
          processFrame(frame);
        }
      }
      if (buffer.trim()) {
        processFrame(buffer);
      }

      if (!streamedText.trim() && chatMessages.value[textMessageIndex]?.content === '') {
        chatMessages.value.splice(textMessageIndex, 1);
      }

      // Lowcoder-Preview reload nach Apply
      if (hasAppliedOps) {
        setTimeout(() => callbacks.onApplied?.(), 800);
      }
    } catch (error: unknown) {
      // AbortError aus reset() - keine Fehler-Bubble
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      if (!isAbort) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        chatMessages.value.push({ role: 'assistant', content: `Fehler: ${errorMessage}` });
      }
    } finally {
      if (activeStreamController === controller) {
        activeStreamController = null;
      }
    }

    sending.value = false;
    scrollToBottom();
  }

  async function approvePlan(planId: string) {
    const backplaneBase = callbacks.getBackplaneBase();
    approving.value = planId;
    try {
      await fetch(`${backplaneBase}/admin/plans/${planId}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'workspace-user', comment: 'Approved via workspace' }),
      });
      approvedPlans.value.add(planId);
      seenPlanIds.value.add(planId);
      // kein Apply hier das macht der wait-Loop in service.ts
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      chatMessages.value.push({
        role: 'assistant',
        content: `Freigabe fehlgeschlagen: ${errorMessage}`,
      });
    }
    approving.value = '';
  }

  async function rejectPlan(planId: string) {
    const backplaneBase = callbacks.getBackplaneBase();
    try {
      await fetch(`${backplaneBase}/admin/plans/${planId}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: 'workspace-user' }),
      });
      rejectedPlans.value.add(planId);
      seenPlanIds.value.add(planId);
    } catch {
      // best-effort reject
    }
  }

  function reset() {
    // alten Stream abbrechen sonst Tool-Calls auf neuen Case
    if (activeStreamController) {
      activeStreamController.abort();
      activeStreamController = null;
    }
    chatMessages.value = [];
    chatInput.value = '';
    sending.value = false;
    approvedPlans.value.clear();
    rejectedPlans.value.clear();
    seenPlanIds.value.clear();
  }

  return {
    chatMessages,
    chatInput,
    sending,
    approving,
    approvedPlans,
    rejectedPlans,
    seenPlanIds,
    chatContainer,
    sendMessage,
    approvePlan,
    rejectPlan,
    scrollToBottom,
    reset,
  };
}
