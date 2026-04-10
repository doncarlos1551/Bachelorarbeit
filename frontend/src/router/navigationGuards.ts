import type { Router } from 'vue-router';

export function registerNavigationGuards(router: Router): void {
  router.beforeEach((to) => {
    const mode = to.query.mode as string | undefined;
    const session = to.query.session as string | undefined;

    // StudyMode braucht SessionID
    if (mode === 'study' && !session) {
      console.warn('[router] Study-Mode ohne session-Parameter, redirect zu free mode');
      return { path: '/', query: { ...to.query, mode: 'free', session: undefined } };
    }

    return true;
  });

  router.afterEach((to) => {
    const mode = to.query.mode as string | undefined;
    const base = (to.meta.title as string) || 'MSL';
    document.title = mode === 'study' ? `${base} - Studie` : base;
  });
}
