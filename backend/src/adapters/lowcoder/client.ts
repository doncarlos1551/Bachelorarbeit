import {
  isRecord,
  readBoolean,
  readPositiveInt,
  type JsonRecord,
} from "src/shared/utils";

export interface LowcoderProjectRef {
  applicationId: string;
  orgId: string;
  name: string;
  title?: string;
}

export interface LoadedApplication {
  project: LowcoderProjectRef;
  payload: JsonRecord;
  applicationDsl: JsonRecord;
}

interface LowcoderClientConfig {
  baseUrl: string;
  apiToken: string;
  autoCreateProject: boolean;
  timeoutMs: number;
}

export class LowcoderClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly autoCreateProject: boolean;
  private readonly timeoutMs: number;

  constructor(config: LowcoderClientConfig) {
    if (!config.apiToken) {
      throw new Error("LOWCODER_API_TOKEN is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.autoCreateProject = config.autoCreateProject;
    this.timeoutMs = config.timeoutMs;
  }

  static fromEnv(): LowcoderClient {
    return new LowcoderClient({
      baseUrl: process.env.LOWCODER_BASE_URL ?? "http://127.0.0.1:3100",
      apiToken: process.env.LOWCODER_API_TOKEN ?? "",
      autoCreateProject: readBoolean(
        process.env.LOWCODER_API_AUTO_CREATE_PROJECT,
        true,
      ),
      timeoutMs: readPositiveInt(process.env.LOWCODER_API_TIMEOUT_MS, 10000),
    });
  }

  async listProjects(): Promise<LowcoderProjectRef[]> {
    const data = await this.request<unknown[]>("/api/applications/list");
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter(isRecord)
      .map((entry) => ({
        applicationId: readStringField(entry, "applicationId"),
        orgId: readStringField(entry, "orgId"),
        name: readStringField(entry, "name"),
        title: readOptionalStringField(entry, "title"),
      }))
      .filter(
        (entry) => entry.applicationId.length > 0 && entry.name.length > 0,
      );
  }

  async createProject(projectName: string): Promise<LowcoderProjectRef> {
    const normalized = projectName.trim();
    if (!normalized) {
      throw new Error("projectName must not be empty");
    }

    const orgId = await this.getCurrentOrgId();
    const created = await this.request<JsonRecord>("/api/applications", {
      method: "POST",
      body: {
        orgId,
        name: normalized,
        applicationType: 1,
        editingApplicationDSL: {},
      },
    });

    const info = isRecord(created.applicationInfoView)
      ? created.applicationInfoView
      : {};
    const applicationId = readStringField(info, "applicationId");
    if (!applicationId) {
      throw new Error(
        "Lowcoder create succeeded but no applicationId was returned",
      );
    }

    return {
      applicationId,
      orgId: readStringField(info, "orgId", orgId),
      name: readStringField(info, "name", normalized),
      title: readOptionalStringField(info, "title"),
    };
  }

  async resolveProject(projectIdOrName: string): Promise<LowcoderProjectRef> {
    const selector = projectIdOrName.trim();
    if (!selector) {
      throw new Error("projectId must not be empty");
    }

    const projects = await this.listProjects();
    const found = projects.find(
      (project) =>
        project.applicationId === selector ||
        project.name.toLowerCase() === selector.toLowerCase() ||
        (project.title ?? "").toLowerCase() === selector.toLowerCase(),
    );
    if (found) {
      return found;
    }

    if (!this.autoCreateProject) {
      throw new Error(`Lowcoder project '${selector}' not found`);
    }

    return this.createProject(selector);
  }

  // Lädt editing-DSL bevorzugt vor published-DSL.
  // Lowcoder unterscheidet drei DSL-Felder pro Application (siehe API-Spec PUT/GET /api/applications):
  // - editingApplicationDSL = Editor-Draft (unsaved oder gesaved aber unpublished), MSL-Schreibziel
  // - publishedApplicationDSL = Live-Stand für End-User, wird per Lowcoder-Deploy aktualisiert
  // - applicationDSL = GET-Response-Feld, je nach Permissions/Context current editing oder published
  // MSL-Operationen wirken via PUT auf editingApplicationDSL, ohne publishedApplicationDSL zu betreffen
  // alles ist somit erst durch User-Deploy in Lowcoder komplett live
  async getApplication(projectIdOrName: string): Promise<LoadedApplication> {
    const project = await this.resolveProject(projectIdOrName);
    const payload = await this.request<JsonRecord>(
      `/api/applications/${project.applicationId}`,
    );
    const editingDsl = isRecord(payload.editingApplicationDSL)
      ? payload.editingApplicationDSL
      : null;
    const publishedDsl = isRecord(payload.applicationDSL)
      ? payload.applicationDSL
      : {};
    const applicationDsl = structuredClone(editingDsl ?? publishedDsl);
    return {
      project,
      payload,
      applicationDsl,
    };
  }

  // Schreibt in die editing-DSL
  // Publish (editing -> published) ist ein separater Lowcoder-Schritt im UI ("Deploy")
  // wird vom MSL nicht ausgelöst -> produktive End-User der App sehen die Änderung erst nach Publish
  // Mehrere applyPlan-Aufrufe sammeln sich in der editing-DSL und werden erst beim Publish richtig live
  async saveApplication(
    loaded: LoadedApplication,
    nextApplicationDsl: JsonRecord,
  ): Promise<JsonRecord> {
    const body = buildUpdateApplicationPayload(
      loaded.payload,
      nextApplicationDsl,
      loaded.project,
    );
    return this.request<JsonRecord>(
      `/api/applications/${loaded.project.applicationId}`,
      {
        method: "PUT",
        body,
      },
    );
  }

  private async getCurrentOrgId(): Promise<string> {
    const me = await this.request<JsonRecord>("/api/users/me");
    const currentOrgId = readStringField(me, "currentOrgId");
    if (currentOrgId) {
      return currentOrgId;
    }

    const orgAndRoles = Array.isArray(me.orgAndRoles) ? me.orgAndRoles : [];
    for (const entry of orgAndRoles) {
      if (!isRecord(entry)) {
        continue;
      }
      const org = isRecord(entry.org) ? entry.org : null;
      if (!org) {
        continue;
      }
      const orgId = readStringField(org, "id");
      if (orgId) {
        return orgId;
      }
    }
    throw new Error(
      "Could not resolve currentOrgId from Lowcoder /api/users/me",
    );
  }

  private async request<T>(
    path: string,
    options?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiToken}`,
    };
    let body: string | undefined;
    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options?.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new Error(
          `Lowcoder request timeout after ${this.timeoutMs}ms: ${path}`,
        );
      }
      const message =
        error instanceof Error ? error.message : "unknown network error";
      throw new Error(`Lowcoder request failed for ${path}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let parsed: unknown = {};
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(
          `Lowcoder response was not JSON (${response.status}): ${String(error)}`,
        );
      }
    }

    if (!response.ok) {
      throw new Error(
        `Lowcoder HTTP ${response.status}: ${extractErrorMessage(parsed)}`,
      );
    }
    if (isRecord(parsed) && "success" in parsed && parsed.success === false) {
      throw new Error(`Lowcoder API error: ${extractErrorMessage(parsed)}`);
    }

    if (isRecord(parsed) && "data" in parsed) {
      return parsed.data as T;
    }
    return parsed as T;
  }
}

const buildUpdateApplicationPayload = (
  liveData: JsonRecord,
  nextApplicationDsl: JsonRecord,
  project: LowcoderProjectRef,
): JsonRecord => {
  const info = isRecord(liveData.applicationInfoView)
    ? liveData.applicationInfoView
    : {};

  return {
    name: readStringField(info, "name", project.name),
    editingApplicationDSL: nextApplicationDsl,
  };
};

const isAbortError = (error: unknown): boolean => {
  return isRecord(error) && error.name === "AbortError";
};

const readStringField = (
  record: JsonRecord,
  key: string,
  fallback = "",
): string => {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
};

const readOptionalStringField = (
  record: JsonRecord,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const extractErrorMessage = (parsed: unknown): string => {
  if (isRecord(parsed)) {
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      return parsed.message;
    }
    if (isRecord(parsed.data) && typeof parsed.data.message === "string") {
      return parsed.data.message;
    }
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const first = parsed.errors[0];
      if (typeof first === "string") {
        return first;
      }
    }
  }
  return "unknown error";
};
