import { ref, computed } from 'vue';

// StudyVarianten steuern Sichtbarkeit der MSL-Felder im Frontend
export type StudyVariant = 'summary' | 'diff' | 'diff_risk' | 'full';

export interface StudyTask {
  caseId: string;
  title: string;
  description: string;
  variant: StudyVariant;
  examplePrompt?: string;
  expectedBehavior?: string;
  groundTruth?: {
    risk: string;
    decision: 'approve' | 'reject';
    why: string;
  };
}

export interface StudyRatings {
  trust: number;
  confidence: number;
  transparency: number;
  control: number;
  notes: string;
  decisionTimeMs: number;
  // Selbsteinschätzung Teilnehmer - unabhängig von MSL-Decision
  taskSucceeded: boolean;
}

export function useWorkspaceStudy() {
  const phase = ref<'consent' | 'task' | 'rating' | 'completion'>('consent');
  const tasks = ref<StudyTask[]>([]);
  const taskIndex = ref(0);
  const taskStartTime = ref(0);

  const showConsentDialog = ref(true);
  const showTaskDialog = ref(false);
  const showRatingsDialog = ref(false);
  const showCompletionDialog = ref(false);

  const ratings = ref({ trust: 4, confidence: 4, transparency: 4, control: 4 });
  const ratingNotes = ref('');
  const taskSucceeded = ref(true);
  const allRatings = ref<StudyRatings[]>([]);

  // SUS Brooke 1996, plus Gesamtvertrauen
  const susItems = ref([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  const overallTrust = ref(4);
  const wouldUse = ref<'yes' | 'maybe' | 'no'>('maybe');
  const feedbackText = ref('');

  const currentTask = computed(() => tasks.value[taskIndex.value] ?? null);
  const progress = computed(() => `${taskIndex.value + 1}/${tasks.value.length}`);
  const isLastTask = computed(() => taskIndex.value >= tasks.value.length - 1);

  const acceptConsent = () => {
    showConsentDialog.value = false;
    phase.value = 'task';
    showTaskDialog.value = true;
  };

  const startTask = () => {
    showTaskDialog.value = false;
    taskStartTime.value = Date.now();
  };

  const openTaskDialog = () => {
    showTaskDialog.value = true;
  };

  const openRatingsDialog = () => {
    showRatingsDialog.value = true;
  };

  const submitRatings = (): StudyRatings => {
    const result: StudyRatings = {
      ...ratings.value,
      notes: ratingNotes.value,
      decisionTimeMs: Date.now() - taskStartTime.value,
      taskSucceeded: taskSucceeded.value,
    };
    allRatings.value.push(result);
    showRatingsDialog.value = false;

    ratings.value = { trust: 4, confidence: 4, transparency: 4, control: 4 };
    ratingNotes.value = '';
    taskSucceeded.value = true;

    return result;
  };

  const nextTask = () => {
    if (isLastTask.value) {
      phase.value = 'completion';
      showCompletionDialog.value = true;
      return false;
    }
    taskIndex.value++;
    showTaskDialog.value = true;
    return true;
  };

  const setTasks = (newTasks: StudyTask[]) => {
    tasks.value = newTasks;
    taskIndex.value = 0;
  };

  const getCompletionData = () => ({
    ratings: allRatings.value,
    sus: susItems.value,
    overallTrust: overallTrust.value,
    wouldUse: wouldUse.value,
    feedback: feedbackText.value,
  });

  return {
    phase,
    tasks,
    taskIndex,
    currentTask,
    progress,
    isLastTask,
    showConsentDialog,
    showTaskDialog,
    showRatingsDialog,
    showCompletionDialog,
    ratings,
    ratingNotes,
    taskSucceeded,
    allRatings,
    susItems,
    overallTrust,
    wouldUse,
    feedbackText,
    acceptConsent,
    startTask,
    openTaskDialog,
    openRatingsDialog,
    submitRatings,
    nextTask,
    setTasks,
    getCompletionData,
  };
}
