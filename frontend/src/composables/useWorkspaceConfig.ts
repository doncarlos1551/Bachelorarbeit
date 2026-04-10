import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { MslClient } from 'src/features/msl-client/api';

export type WorkspaceMode = 'free' | 'study';

export function useWorkspaceConfig() {
  const route = useRoute();

  const mode = computed<WorkspaceMode>(() => {
    const modeParam = route.query.mode as string | undefined;
    return modeParam === 'study' ? 'study' : 'free';
  });

  const isStudyMode = computed(() => mode.value === 'study');
  const studySessionId = computed(() => (route.query.session as string) || '');
  const projectIdFromUrl = computed(() => (route.query.project as string) || '');
  const designFromUrl = computed(() => (route.query.design as string) || '');
  const modelFromUrl = computed(() => (route.query.model as string) || 'gpt-4o-mini');

  const backplaneBase = import.meta.env.VITE_MSL_BACKPLANE_BASE_URL || '/api';
  // Lowcoder direkt auf Port - kein path-Proxy
  const lowcoderBase =
    import.meta.env.VITE_LOWCODER_BASE_URL || `http://${window.location.hostname}:3100`;

  const api = new MslClient({
    baseUrl: backplaneBase,
    actorId: 'workspace-user',
  });

  return {
    mode,
    isStudyMode,
    studySessionId,
    projectIdFromUrl,
    designFromUrl,
    modelFromUrl,
    backplaneBase,
    lowcoderBase,
    api,
  };
}
