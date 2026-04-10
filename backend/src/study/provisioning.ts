import type { LowcoderClient } from "src/adapters/lowcoder/client";
import type { JsonRecord } from "src/shared/utils";

const TEMPLATE_PROJECT_NAME = "Study Template - Customer Portal";

export class StudyProvisioner {
  private readonly client: LowcoderClient;
  private templateDsl: JsonRecord | undefined;
  constructor(client: LowcoderClient) {
    this.client = client;
  }

  async cloneForCaseRun(input: {
    participantId: string;
    caseId: string;
    caseRunId: string;
  }): Promise<{ projectId: string; projectName: string }> {
    const templateDsl = await this.loadTemplateDsl();

    const projectName = `study_${input.participantId}_${input.caseId}_${input.caseRunId.slice(-8)}`;
    const project = await this.client.createProject(projectName);

    const loaded = await this.client.getApplication(project.applicationId);
    await this.client.saveApplication(loaded, templateDsl);

    return {
      projectId: project.applicationId,
      projectName: project.name,
    };
  }

  private async loadTemplateDsl(): Promise<JsonRecord> {
    if (this.templateDsl) return this.templateDsl;

    try {
      const loaded = await this.client.getApplication(TEMPLATE_PROJECT_NAME);
      this.templateDsl = loaded.applicationDsl;
      return this.templateDsl;
    } catch (_e) {
      // fallback
      console.warn(
        `[study] Template project "${TEMPLATE_PROJECT_NAME}" not found, using empty DSL`,
      );
      this.templateDsl = {
        ui: { compType: "module", comp: {} },
        queries: [],
        tempStates: [],
        settings: {},
        preload: {},
      };
      return this.templateDsl;
    }
  }
}
