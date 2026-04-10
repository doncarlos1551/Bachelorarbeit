import { Router } from "express";
import { createHash } from "node:crypto";
import { StudyStore } from "src/study/store";
import {
  STUDY_CASES,
  COUNTERBALANCE_DESIGNS,
  getVariantForCase,
  getCaseById,
} from "src/study/cases";
import type {
  CaseStatus,
  MslVariant,
  ParticipantGroup,
  StudyResponse,
  StudySession,
  StudySessionStatus,
} from "src/study/domain";
import { StudyProvisioner } from "src/study/provisioning";
import { LowcoderClient } from "src/adapters/lowcoder/client";
import { loadBaselineDsl } from "src/study/fixture-loader";
import { isRecord, type JsonRecord } from "src/shared/utils";

import type { StudyMslHooks } from "src/study/msl-hooks";

export const createStudyRouter = (
  dataDir: string,
  mslService?: StudyMslHooks,
): Router => {
  const router = Router();
  const store = new StudyStore(dataDir);

  let provisioner: StudyProvisioner | undefined;
  const getProvisioner = (): StudyProvisioner => {
    if (!provisioner) {
      provisioner = new StudyProvisioner(LowcoderClient.fromEnv());
    }
    return provisioner;
  };

  // === Cases und Designs, read-only ===

  router.get("/cases", (_req, res) => {
    res.json({ cases: STUDY_CASES, count: STUDY_CASES.length });
  });

  router.get("/cases/:caseId", (req, res) => {
    const studyCase = getCaseById(req.params.caseId ?? "");
    if (!studyCase) {
      res.status(404).json({ ok: false, message: "Case not found" });
      return;
    }
    res.json(studyCase);
  });

  router.get("/designs", (_req, res) => {
    res.json({ designs: COUNTERBALANCE_DESIGNS });
  });

  router.get("/live-tasks", (_req, res) => {
    res.json({
      tasks: STUDY_CASES,
      count: STUDY_CASES.length,
      designs: COUNTERBALANCE_DESIGNS,
    });
  });

  // Backwards-Compat @ToDo check später irrelevant?
  router.get("/tasks", (_req, res) => {
    res.json({
      tasks: STUDY_CASES,
      count: STUDY_CASES.length,
      designs: COUNTERBALANCE_DESIGNS,
    });
  });

  // === Case-Config ===
  router.post("/case-config", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const variant = readText(body.variant);
      const sessionId = readOptionalText(body.sessionId);

      if (!isOneOf(variant, CASE_CONFIG_VARIANTS)) {
        res.status(400).json({
          ok: false,
          message: `variant must be one of: ${CASE_CONFIG_VARIANTS.join(", ")}`,
        });
        return;
      }

      if (sessionId) {
        const session = await store.getSession(sessionId);
        if (!session) {
          res.status(403).json({ ok: false, message: "Invalid session" });
          return;
        }
      }

      // variant tracked nur im UI-Filter kein backend-state
      res.json({
        ok: true,
        variant,
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // === Projekt-Reset ===

  router.post("/reset-project", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const projectId = readText(body.projectId);
      if (!projectId) {
        res.status(400).json({ ok: false, message: "projectId required" });
        return;
      }

      const client = LowcoderClient.fromEnv();

      const templateName = "Study Template - Customer Portal";
      const projects = await client.listProjects();
      const template = projects.find((p) => p.name === templateName);
      if (!template) {
        res
          .status(404)
          .json({ ok: false, message: `Template '${templateName}' not found` });
        return;
      }

      const isTemplate = projectId === template.applicationId;
      let resetDsl: JsonRecord;

      if (isTemplate) {
        resetDsl = loadBaselineDsl();
      } else {
        const templateApp = await client.getApplication(template.applicationId);
        resetDsl = templateApp.applicationDsl;
      }

      const targetApp = await client.getApplication(projectId);
      await client.saveApplication(targetApp, resetDsl);

      res.json({
        ok: true,
        message: isTemplate
          ? "Template reset to fixture"
          : "Project reset to template",
        projectId,
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // === Sessions ===

  router.get("/sessions", async (_req, res) => {
    try {
      const sessions = await store.listSessions();
      res.json({ sessions, count: sessions.length });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.get("/sessions/:id", async (req, res) => {
    try {
      const session = await store.getSession(req.params.id ?? "");
      if (!session) {
        res.status(404).json({ ok: false, message: "Session not found" });
        return;
      }
      const runs = await store.listCaseRuns(session.studySessionId);
      const responses = await store.listResponses(session.studySessionId);
      res.json({ session, caseRuns: runs, responses });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.post("/sessions", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const participantId = readText(body.participantId);
      const participantGroup = readParticipantGroup(body.participantGroup);
      const designId = readText(body.counterbalanceDesignId || "A");

      if (!participantId || !participantGroup) {
        res.status(400).json({
          ok: false,
          message: "participantId and participantGroup are required",
        });
        return;
      }

      // Case-Reihenfolge aus Counterbalance-Design
      const design = COUNTERBALANCE_DESIGNS.find(
        (d) => d.designId === designId,
      );
      const caseSequence = design
        ? design.blocks.flatMap((b) => b.caseIds)
        : STUDY_CASES.map((c) => c.caseId);

      const mslVariant = design?.blocks[0]?.variant ?? "diff_risk";

      // Template-Klon pro Teilnehmer
      let projectId: string | undefined;
      try {
        const provResult = await getProvisioner().cloneForCaseRun({
          participantId,
          caseId: "session",
          caseRunId: `${Date.now().toString(36)}_init`,
        });
        projectId = provResult.projectId;
      } catch (e) {
        console.warn(
          "[study] Project clone failed, participant must select project manually:",
          e instanceof Error ? e.message : e,
        );
      }

      // jede Study-Session startet in enforceManual,
      if (mslService) {
        try {
          await mslService.updateBackplaneConfig({
            patch: {
              executionMode: "manual",
              approvalRiskThreshold: "medium",
              gateModes: {
                policy: "enforce",
                preflight: "enforce",
                diff: "observe",
                risk: "observe",
                validation: "enforce",
                approval: "enforce",
                audit: "observe",
              },
            },
            actorId: `study-session-init:${participantId}`,
          });
        } catch (e) {
          console.warn(
            "[study] Baseline gate-config failed:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      // offene Plans des vorherigen Teilnehmers rejecten
      if (mslService) {
        try {
          const cleanup = await mslService.cleanupOpenPlans({
            scope: "all",
            reason: `New study session for ${participantId}`,
          });
          if (cleanup.rejectedCount > 0) {
            console.info(
              `[study] Cleaned ${cleanup.rejectedCount} open plans before session ${participantId}`,
            );
          }
        } catch (e) {
          console.warn(
            "[study] Plan cleanup failed:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      const session = await store.createSession({
        participantId,
        participantGroup,
        counterbalanceDesignId: designId,
        mslVariant,
        caseSequence,
        metadata: {
          ...(isRecord(body.metadata) ? body.metadata : {}),
          ...(projectId ? { projectId } : {}),
        },
      });

      // Plan-Join Workaround studySessionId als actorId, mslSessionId per sha256
      const mslSessionId =
        "msl_" +
        createHash("sha256")
          .update(session.studySessionId)
          .digest("hex")
          .slice(0, 16);
      await store.updateSession(session.studySessionId, { mslSessionId });
      const sessionWithMsl = { ...session, mslSessionId };

      const urlBase = `/#/?mode=study&session=${session.studySessionId}`;
      res.status(201).json({
        session: sessionWithMsl,
        ...(projectId
          ? { projectId, projectUrl: `${urlBase}&project=${projectId}` }
          : { projectUrl: urlBase }),
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.patch("/sessions/:id", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      await store.updateSession(req.params.id ?? "", {
        status: readSessionStatus(body.status),
        currentCaseIndex:
          typeof body.currentCaseIndex === "number"
            ? body.currentCaseIndex
            : undefined,
        mslSessionId: readOptionalText(body.mslSessionId),
        completedAt: readOptionalText(body.completedAt),
      });
      const updated = await store.getSession(req.params.id ?? "");
      res.json({ session: updated });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // === Case Runs ===

  router.post("/sessions/:sessionId/case-runs", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const caseId = readText(body.caseId);
      const session = await store.getSession(req.params.sessionId ?? "");
      if (!session) {
        res.status(404).json({ ok: false, message: "Session not found" });
        return;
      }
      if (!caseId) {
        res.status(400).json({ ok: false, message: "caseId is required" });
        return;
      }

      const variant = getVariantForCase(session.counterbalanceDesignId, caseId);
      const studyCase = getCaseById(caseId);
      const provisionProject = body.provisionProject === true;

      // optional Lowcoder-Projekt klonen nur im Case-Mode
      let projectId = readOptionalText(body.projectId);
      let provisionResult:
        | { projectId: string; projectName: string }
        | undefined;
      if (provisionProject && !projectId) {
        try {
          provisionResult = await getProvisioner().cloneForCaseRun({
            participantId: session.participantId,
            caseId,
            caseRunId: `${Date.now().toString(36)}_${caseId}`,
          });
          projectId = provisionResult.projectId;
        } catch (e) {
          console.warn(
            "[study] Project provisioning failed:",
            e instanceof Error ? e.message : e,
          );
          // ohne Projekt weiter, simulierte Gates greifen trotzdem
        }
      }

      // offene Plans des vorherigen Case-Runs rejecten
      if (mslService && session.mslSessionId) {
        try {
          await mslService.cleanupOpenPlans({
            scope: "session",
            sessionId: session.mslSessionId,
            reason: `New case-run ${caseId} for ${session.participantId}`,
          });
        } catch (e) {
          console.warn(
            "[study] Case-run plan cleanup failed:",
            e instanceof Error ? e.message : e,
          );
        }
      }

      const run = await store.createCaseRun({
        studySessionId: session.studySessionId,
        caseId,
        variant,
        ...(projectId ? { projectId } : {}),
      });

      // kein Auto-Eval, Teilnehmer prompt frei, MSL pruft im normalen Flow
      res.status(201).json({
        caseRun: run,
        case: studyCase,
        variant,
        ...(provisionResult ? { provisionedProject: provisionResult } : {}),
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.get("/case-runs/:id", async (req, res) => {
    try {
      const run = await store.getCaseRun(req.params.id ?? "");
      if (!run) {
        res.status(404).json({ ok: false, message: "Case run not found" });
        return;
      }
      res.json({ caseRun: run });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.patch("/case-runs/:id", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      await store.updateCaseRun(req.params.id ?? "", {
        status: readCaseStatus(body.status),
        projectId: readOptionalText(body.projectId),
        completedAt: readOptionalText(body.completedAt),
      });
      const updated = await store.getCaseRun(req.params.id ?? "");
      res.json({ caseRun: updated });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.post("/case-runs/:id/plan", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const planId = readText(body.planId);
      if (!planId) {
        res.status(400).json({ ok: false, message: "planId is required" });
        return;
      }
      await store.appendPlanId(req.params.id ?? "", planId);
      res.json({ ok: true });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.post("/case-runs/:id/gate-event", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      await store.appendGateEvent(req.params.id ?? "", {
        timestamp: new Date().toISOString(),
        planId: readText(body.planId),
        gate: readText(body.gate),
        mode: readText(body.mode),
        passed: body.passed === true,
        blocked: body.blocked === true,
        riskLevel: readOptionalText(body.riskLevel),
        riskScore:
          typeof body.riskScore === "number" ? body.riskScore : undefined,
      });
      res.json({ ok: true });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // === Responses ===

  router.post("/responses", async (req, res) => {
    try {
      const body = readRequestBody(req.body);
      const variant = readMslVariant(body.variant);
      if (!variant) {
        res.status(400).json({ ok: false, message: "variant is required" });
        return;
      }
      const response = await store.createResponse({
        studySessionId: readText(body.studySessionId),
        caseRunId: readText(body.caseRunId),
        caseId: readText(body.caseId),
        variant,
        decision: readDecision(body.decision),
        correct: typeof body.correct === "boolean" ? body.correct : undefined,
        decisionTimeMs:
          typeof body.decisionTimeMs === "number"
            ? body.decisionTimeMs
            : undefined,
        trustRating:
          typeof body.trustRating === "number" ? body.trustRating : undefined,
        confidenceRating:
          typeof body.confidenceRating === "number"
            ? body.confidenceRating
            : undefined,
        transparencyRating:
          typeof body.transparencyRating === "number"
            ? body.transparencyRating
            : undefined,
        controlRating:
          typeof body.controlRating === "number"
            ? body.controlRating
            : undefined,
        notes: readOptionalText(body.notes),
        additionalItems: isRecord(body.additionalItems)
          ? body.additionalItems
          : undefined,
      });
      res.status(201).json({ response });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  router.get("/responses", async (req, res) => {
    try {
      const sessionId = readOptionalText(req.query.studySessionId);
      const responses = sessionId
        ? await store.listResponses(sessionId)
        : await store.listAllResponses();
      res.json({ responses, count: responses.length });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // === Export ===
  router.get("/export/:sessionId", async (req, res) => {
    try {
      const session = await store.getSession(req.params.sessionId ?? "");
      if (!session) {
        res.status(404).json({ ok: false, message: "Session not found" });
        return;
      }
      const caseRuns = await store.listCaseRuns(session.studySessionId);
      const responses = await store.listResponses(session.studySessionId);

      const plans = await joinSessionPlans(mslService, session);

      res.json({
        version: "v1",
        exportedAt: new Date().toISOString(),
        session,
        caseRuns,
        responses,
        plans,
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // CSV-Export von Session
  router.get("/export/:sessionId/csv", async (req, res) => {
    try {
      const session = await store.getSession(req.params.sessionId ?? "");
      if (!session) {
        res.status(404).json({ ok: false, message: "Session not found" });
        return;
      }
      const responses = await store.listResponses(session.studySessionId);

      const csv = buildCsv(session, responses);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="msl_study_${session.participantId}_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(csv);
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // Bulk-Export aller Sessions als JSON
  router.get("/export-all", async (_req, res) => {
    try {
      const sessions = await store.listSessions();
      const allData = [];
      for (const session of sessions) {
        const caseRuns = await store.listCaseRuns(session.studySessionId);
        const responses = await store.listResponses(session.studySessionId);
        const plans = await joinSessionPlans(mslService, session);
        allData.push({ session, caseRuns, responses, plans });
      }
      res.json({
        version: "v1",
        exportedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        data: allData,
      });
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  // Bulk-Export aller Responses als CSV
  router.get("/export-all/csv", async (_req, res) => {
    try {
      const sessions = await store.listSessions();
      const rows: string[] = [CSV_HEADER];
      for (const session of sessions) {
        const responses = await store.listResponses(session.studySessionId);
        for (const r of responses) {
          rows.push(buildCsvRow(session, r));
        }
      }
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="msl_study_all_${new Date().toISOString().slice(0, 10)}.csv"`,
      );
      res.send(rows.join("\n"));
    } catch (e) {
      respondError(res, 500, e);
    }
  });

  return router;
};

const readText = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  return "";
};

const readOptionalText = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  return undefined;
};

const PARTICIPANT_GROUPS: readonly ParticipantGroup[] = [
  "professional_dev",
  "citizen_dev",
];
const CASE_CONFIG_VARIANTS: readonly MslVariant[] = [
  "summary",
  "diff",
  "diff_risk",
  "full",
];
const MSL_VARIANTS: readonly MslVariant[] = [
  "baseline",
  "summary",
  "diff",
  "diff_risk",
  "full",
];
const SESSION_STATUSES: readonly StudySessionStatus[] = [
  "active",
  "completed",
  "aborted",
];
const CASE_STATUSES: readonly CaseStatus[] = [
  "pending",
  "active",
  "completed",
  "skipped",
];
const RESPONSE_DECISIONS: readonly NonNullable<StudyResponse["decision"]>[] = [
  "approve",
  "reject",
];

const isOneOf = <T extends string>(
  value: string,
  allowed: readonly T[],
): value is T => {
  return allowed.some((entry) => entry === value);
};

const readRequestBody = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const readParticipantGroup = (v: unknown): ParticipantGroup | undefined => {
  const value = readText(v);
  return isOneOf(value, PARTICIPANT_GROUPS) ? value : undefined;
};

const readMslVariant = (v: unknown): MslVariant | undefined => {
  const value = readText(v);
  return isOneOf(value, MSL_VARIANTS) ? value : undefined;
};

const readSessionStatus = (v: unknown): StudySessionStatus | undefined => {
  const value = readOptionalText(v);
  return value && isOneOf(value, SESSION_STATUSES) ? value : undefined;
};

const readCaseStatus = (v: unknown): CaseStatus | undefined => {
  const value = readOptionalText(v);
  return value && isOneOf(value, CASE_STATUSES) ? value : undefined;
};

const readDecision = (v: unknown): StudyResponse["decision"] => {
  const value = readOptionalText(v);
  return value && isOneOf(value, RESPONSE_DECISIONS) ? value : undefined;
};

const respondError = (
  res: { status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  error: unknown,
): void => {
  const message = error instanceof Error ? error.message : String(error);
  res.status(status).json({ ok: false, message });
};

// Plans pro Session, gespeicherte mslSessionId mit Hash-Fallback für Alt-Sessions
const joinSessionPlans = async (
  mslService: StudyMslHooks | undefined,
  session: { studySessionId: string; mslSessionId?: string },
): Promise<unknown[]> => {
  if (!mslService) return [];
  const candidates = new Set<string>();
  if (session.mslSessionId) candidates.add(session.mslSessionId);
  candidates.add(
    "msl_" +
      createHash("sha256")
        .update(session.studySessionId)
        .digest("hex")
        .slice(0, 16),
  );

  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const sessionId of candidates) {
    try {
      const queue = await mslService.getSessionQueue({ sessionId, limit: 100 });
      const open = Array.isArray(queue.openPlans) ? queue.openPlans : [];
      const hist = Array.isArray(queue.historyPlans) ? queue.historyPlans : [];
      for (const plan of [...open, ...hist]) {
        const id = readPlanId(plan);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(plan);
      }
    } catch {
      // MSL-Plans optional
    }
  }
  return merged;
};

// === CSV-Export Helpers ===

const CSV_HEADER = [
  "participant_id",
  "participant_group",
  "counterbalance_design",
  "session_id",
  "session_status",
  "age_range",
  "role",
  "dev_experience",
  "ai_experience",
  "lowcode_experience",
  "case_id",
  "variant",
  "decision",
  "correct",
  "decision_time_ms",
  "trust_rating",
  "confidence_rating",
  "transparency_rating",
  "control_rating",
  "notes",
  "response_id",
  "created_at",
].join(",");

const csvEscape = (val: unknown): string => {
  if (val == null) return "";
  const text = String(val);
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const buildCsvRow = (session: StudySession, r: StudyResponse): string => {
  const pre: Record<string, unknown> =
    isRecord(session.metadata) && isRecord(session.metadata.preQuestionnaire)
      ? session.metadata.preQuestionnaire
      : {};
  return [
    csvEscape(session.participantId),
    csvEscape(session.participantGroup),
    csvEscape(session.counterbalanceDesignId),
    csvEscape(session.studySessionId),
    csvEscape(session.status),
    csvEscape(pre?.ageRange),
    csvEscape(pre?.role),
    csvEscape(pre?.devExperienceYears),
    csvEscape(pre?.aiExperience),
    csvEscape(pre?.lowCodeExperience),
    csvEscape(r.caseId),
    csvEscape(r.variant),
    csvEscape(r.decision),
    csvEscape(r.correct != null ? (r.correct ? "1" : "0") : ""),
    csvEscape(r.decisionTimeMs),
    csvEscape(r.trustRating),
    csvEscape(r.confidenceRating),
    csvEscape(r.transparencyRating),
    csvEscape(r.controlRating),
    csvEscape(r.notes),
    csvEscape(r.responseId),
    csvEscape(r.createdAt),
  ].join(",");
};

const readPlanId = (value: unknown): string => {
  return isRecord(value) && typeof value.planId === "string"
    ? value.planId
    : "";
};

const buildCsv = (
  session: StudySession,
  responses: StudyResponse[],
): string => {
  const rows = [CSV_HEADER, ...responses.map((r) => buildCsvRow(session, r))];
  return rows.join("\n");
};
