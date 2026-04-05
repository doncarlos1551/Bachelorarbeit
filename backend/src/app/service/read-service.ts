import {
  inspectApplicationDsl,
  listComponentsFromApplicationDsl,
  summarizeApplicationDsl,
} from "src/adapters/lowcoder/dsl";
import type { WorkspaceContext } from "src/app/context-store.interfaces";
import type { BaselineService } from "src/app/service/baseline-service";

export const getWorkspaceContext = (
  service: BaselineService,
): WorkspaceContext => service.context.get();

export const setWorkspaceContext = (
  service: BaselineService,
  input: {
    projectId?: string;
    actorId?: string;
    sessionId?: string;
    chatId?: string;
  },
): WorkspaceContext => service.context.set(input);

export const listProjects = async (
  service: BaselineService,
  limit: number,
  search?: string,
): Promise<Record<string, unknown>> => {
  let projects = await service.client.listProjects();
  if (search) {
    const needle = search.toLowerCase();
    projects = projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        (project.title ?? "").toLowerCase().includes(needle),
    );
  }
  return {
    count: projects.length,
    projects: projects.slice(0, limit),
  };
};

export const createProject = async (
  service: BaselineService,
  projectName: string,
): Promise<Record<string, unknown>> => {
  const project = await service.client.createProject(projectName);
  const context = service.context.set({ projectId: project.name });
  return {
    mode: "baseline_direct_apply",
    project,
    workspaceContext: context,
  };
};

export const projectSummary = async (
  service: BaselineService,
  projectId?: string,
): Promise<Record<string, unknown>> => {
  const resolvedProjectId = resolveProjectId(service, projectId);
  const loaded = await service.client.getApplication(resolvedProjectId);
  const summary = summarizeApplicationDsl(loaded.applicationDsl);
  return {
    mode: "baseline_direct_apply",
    project: loaded.project,
    summary,
  };
};

export const listComponents = async (
  service: BaselineService,
  projectId?: string,
  limit = 200,
): Promise<Record<string, unknown>> => {
  const resolvedProjectId = resolveProjectId(service, projectId);
  const loaded = await service.client.getApplication(resolvedProjectId);
  const components = listComponentsFromApplicationDsl(
    loaded.applicationDsl,
  ).slice(0, limit);
  return {
    mode: "baseline_direct_apply",
    project: loaded.project,
    count: components.length,
    components,
  };
};

export const inspectDsl = async (
  service: BaselineService,
  projectId?: string,
  options?: { componentId?: string; includeRawDsl?: boolean },
): Promise<Record<string, unknown>> => {
  const resolvedProjectId = resolveProjectId(service, projectId);
  const loaded = await service.client.getApplication(resolvedProjectId);
  return {
    mode: "baseline_direct_apply",
    project: loaded.project,
    inspection: inspectApplicationDsl(loaded.applicationDsl, {
      componentId: options?.componentId,
      includeRawDsl: options?.includeRawDsl,
    }),
  };
};

// aktive actorId aus Workspace-Context mit fallback auf default-string
export const resolveActorId = (service: BaselineService): string => {
  const actorId = service.context.get().actorId.trim();
  return actorId.length > 0 ? actorId : "unknown-actor";
};

// projectId aus Input oder Context, throws wenn beides leer ist
// setzt im Erfolgsfall auch den Context für Folge-Aufrufe
export const resolveProjectId = (
  service: BaselineService,
  projectId?: string,
): string => {
  const fromInput = projectId?.trim();
  if (fromInput) {
    service.context.set({ projectId: fromInput });
    return fromInput;
  }

  const fromContext = service.context.get().projectId?.trim();
  if (fromContext) {
    return fromContext;
  }
  throw new Error(
    "No projectId provided and workspace context has no projectId. Call set_workspace_context first.",
  );
};
