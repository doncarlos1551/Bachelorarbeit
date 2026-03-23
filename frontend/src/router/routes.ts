import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('layouts/WorkspaceLayout.vue'),
    children: [
      {
        path: '',
        name: 'workspace',
        component: () => import('pages/WorkspacePage.vue'),
        meta: { title: 'MSL Workspace' },
      },
    ],
  },

  {
    path: '/:catchAll(.*)*',
    name: 'not-found',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
