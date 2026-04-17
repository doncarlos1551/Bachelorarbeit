import type { BaselineOperation } from "src/app/operations";

// === Types ===

export interface ContentScanHit {
  pattern: string;
  label: string;
  severity: "high" | "medium" | "low";
  riskPoints: number;
}

export interface ContentScanResult {
  operationKind: string;
  context: string;
  hits: ContentScanHit[];
}

// === Dangerous Patterns ===
// @ToDo eventuell auch LLM Matcher denkbar?

export const DANGEROUS_PATTERNS: Array<{
  test: (value: string) => boolean;
  label: string;
  pattern: string;
  severity: "high" | "medium" | "low";
  riskPoints: number;
}> = [
  {
    test: (v) => /\beval\s*\(/.test(v),
    label: "eval(), dynamic code execution",
    pattern: "eval(",
    severity: "high",
    riskPoints: 40,
  },
  {
    test: (v) => /\bnew\s+Function\s*\(/.test(v),
    label: "Function-Konstruktor, dynamische Code-Erzeugung",
    pattern: "new Function(",
    severity: "high",
    riskPoints: 40,
  },
  {
    test: (v) => /\bFunction\s*\(/.test(v) && !/\bnew\s+Function/.test(v),
    label: "Function(), dynamische Code-Erzeugung",
    pattern: "Function(",
    severity: "high",
    riskPoints: 35,
  },
  {
    test: (v) => v.includes("document.cookie"),
    label: "document.cookie, sensible Daten",
    pattern: "document.cookie",
    severity: "high",
    riskPoints: 35,
  },
  {
    test: (v) => /\.innerHTML\s*=/.test(v),
    label: "innerHTML-Zuweisung, XSS-Vektor",
    pattern: "innerHTML=",
    severity: "high",
    riskPoints: 35,
  },
  {
    test: (v) => /\.outerHTML\s*=/.test(v),
    label: "outerHTML-Zuweisung, XSS-Vektor",
    pattern: "outerHTML=",
    severity: "high",
    riskPoints: 35,
  },
  {
    test: (v) => /<script[\s>]/i.test(v),
    label: "<script>-Tag, Script Injection",
    pattern: "<script>",
    severity: "high",
    riskPoints: 40,
  },
  {
    test: (v) => /javascript\s*:/i.test(v),
    label: "javascript:-Protokoll, Code Injection",
    pattern: "javascript:",
    severity: "high",
    riskPoints: 40,
  },
  {
    test: (v) => /\bfetch\s*\(\s*['"]https?:\/\//.test(v),
    label: "fetch() zu externer URL, Datenexfiltration möglich",
    pattern: "fetch(http)",
    severity: "medium",
    riskPoints: 30,
  },
  {
    test: (v) => /\bXMLHttpRequest\b/.test(v),
    label: "XMLHttpRequest, externe Kommunikation",
    pattern: "XMLHttpRequest",
    severity: "medium",
    riskPoints: 30,
  },
  {
    test: (v) => v.includes("document.write"),
    label: "document.write, DOM-Manipulation",
    pattern: "document.write",
    severity: "medium",
    riskPoints: 25,
  },
  {
    test: (v) => v.includes("document.createElement"),
    label: "document.createElement, DOM-Manipulation",
    pattern: "document.createElement",
    severity: "medium",
    riskPoints: 20,
  },
  {
    test: (v) =>
      /document\.(querySelector|getElementById|getElementsBy)/.test(v),
    label: "DOM-Query, direkter DOM-Zugriff",
    pattern: "document.querySelector",
    severity: "medium",
    riskPoints: 20,
  },
  {
    test: (v) => v.includes("process.env"),
    label: "process.env, Environment-Zugriff",
    pattern: "process.env",
    severity: "medium",
    riskPoints: 25,
  },
  {
    test: (v) => v.includes("window.localStorage"),
    label: "localStorage, persistenter Client-Speicher",
    pattern: "window.localStorage",
    severity: "low",
    riskPoints: 15,
  },
  {
    test: (v) => v.includes("window.sessionStorage"),
    label: "sessionStorage, Client-Speicher",
    pattern: "window.sessionStorage",
    severity: "low",
    riskPoints: 10,
  },
  {
    test: (v) => /\bwindow\.location\b/.test(v),
    label: "window.location, Redirect",
    pattern: "window.location",
    severity: "medium",
    riskPoints: 20,
  },
  {
    test: (v) => /\batob\s*\(/.test(v),
    label: "atob(), Base64-Decode, mogliche Obfuskation",
    pattern: "atob(",
    severity: "low",
    riskPoints: 15,
  },
];

// === Helpers ===

const scanStringForDangerousPatterns = (value: string): ContentScanHit[] => {
  if (!value || value.length < 4) return [];
  const hits: ContentScanHit[] = [];
  for (const entry of DANGEROUS_PATTERNS) {
    if (entry.test(value)) {
      hits.push({
        pattern: entry.pattern,
        label: entry.label,
        severity: entry.severity,
        riskPoints: entry.riskPoints,
      });
    }
  }
  return hits;
};

const extractScannableStrings = (
  operation: BaselineOperation,
): Array<{ value: string; context: string }> => {
  const result: Array<{ value: string; context: string }> = [];

  switch (operation.kind) {
    case "ui.add_component": {
      if (operation.text)
        result.push({
          value: operation.text,
          context: `add_component '${operation.componentId ?? operation.componentType}' text`,
        });
      for (const [key, val] of Object.entries(operation.properties ?? {})) {
        if (typeof val === "string")
          result.push({
            value: val,
            context: `add_component '${operation.componentId ?? operation.componentType}' property '${key}'`,
          });
      }
      for (const [key, val] of Object.entries(operation.events ?? {})) {
        if (typeof val === "string")
          result.push({
            value: val,
            context: `add_component '${operation.componentId ?? operation.componentType}' event '${key}'`,
          });
      }
      break;
    }
    case "ui.update_component_text":
      result.push({
        value: operation.text,
        context: `component '${operation.componentId}' text`,
      });
      break;
    case "ui.update_component_property": {
      const val = operation.value;
      if (typeof val === "string")
        result.push({
          value: val,
          context: `component '${operation.componentId}' property '${operation.propertyPath}'`,
        });
      break;
    }
    case "ui.upsert_binding":
      result.push({
        value: operation.expression,
        context: `binding '${operation.bindingKey}' on '${operation.componentId}'`,
      });
      break;
    case "logic.upsert_function":
      result.push({
        value: operation.code,
        context: `function '${operation.functionName}'`,
      });
      break;
    case "logic.set_component_action":
      result.push({
        value: operation.script,
        context: `action '${operation.actionName}' on '${operation.componentId}'`,
      });
      break;
    case "preload.set_script":
      result.push({ value: operation.script, context: "preload script" });
      break;
    case "preload.set_css":
      result.push({ value: operation.css, context: "preload CSS" });
      break;
    case "preload.set_global_css":
      result.push({ value: operation.css, context: "global CSS" });
      break;
    case "integration.upsert_http_datasource":
      result.push({
        value: operation.url,
        context: `datasource '${operation.name}' URL`,
      });
      break;
    case "state.upsert_temp_state": {
      const val = operation.value;
      if (typeof val === "string")
        result.push({
          value: val,
          context: `tempState '${operation.stateName}' value`,
        });
      break;
    }
    default:
      break;
  }

  return result;
};

// === Public API ===

export const scanOperationsForDangerousContent = (
  operations: BaselineOperation[],
): ContentScanResult[] => {
  const results: ContentScanResult[] = [];
  for (const operation of operations) {
    for (const field of extractScannableStrings(operation)) {
      const hits = scanStringForDangerousPatterns(field.value);
      if (hits.length > 0) {
        results.push({
          operationKind: operation.kind,
          context: field.context,
          hits,
        });
      }
    }
  }
  return results;
};
