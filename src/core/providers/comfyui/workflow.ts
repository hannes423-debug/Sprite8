import defaultWorkflow from '../../../../models/comfyui/sprite8-img2img-basic.json';

/**
 * ComfyUI workflow templates.
 *
 * Any workflow exported from ComfyUI with "Save (API Format)" can be used.
 * Sprite8 replaces {{PLACEHOLDERS}} in string values before queueing it:
 *
 *   {{SOURCE_IMAGE}}        uploaded source view (file name in ComfyUI's input folder)
 *   {{REFERENCE_IMAGE_1..4}} other approved views (falls back to the source)
 *   {{PROMPT}} {{NEGATIVE_PROMPT}} {{INSTRUCTION}}
 *   {{SEED}} {{STEPS}} {{CFG}} {{DENOISE}} {{WIDTH}} {{HEIGHT}}
 *   {{CHECKPOINT}} {{DIRECTION}} {{SOURCE_DIRECTION}}
 *
 * A string that is exactly "{{SEED}}" (etc.) becomes a JSON number when the
 * value is numeric, so templates stay valid JSON.
 */
export const DEFAULT_COMFY_WORKFLOW = JSON.stringify(defaultWorkflow, null, 2);

export const KNOWN_PLACEHOLDERS = [
  'SOURCE_IMAGE',
  'REFERENCE_IMAGE_1',
  'REFERENCE_IMAGE_2',
  'REFERENCE_IMAGE_3',
  'REFERENCE_IMAGE_4',
  'PROMPT',
  'NEGATIVE_PROMPT',
  'INSTRUCTION',
  'SEED',
  'STEPS',
  'CFG',
  'DENOISE',
  'WIDTH',
  'HEIGHT',
  'CHECKPOINT',
  'DIRECTION',
  'SOURCE_DIRECTION',
] as const;

export type PlaceholderValues = Partial<Record<(typeof KNOWN_PLACEHOLDERS)[number], string | number>>;

const WHOLE = /^\{\{([A-Z0-9_]+)\}\}$/;
const ANY = /\{\{([A-Z0-9_]+)\}\}/g;

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

export function parseWorkflow(text: string): ComfyWorkflow {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`The workflow is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('The workflow must be a JSON object (ComfyUI "Save (API Format)").');
  }
  const obj = json as Record<string, unknown>;
  if ('nodes' in obj && 'links' in obj) {
    throw new Error('This is a UI-format workflow. In ComfyUI enable dev mode and use "Save (API Format)" instead.');
  }
  for (const [id, node] of Object.entries(obj)) {
    const n = node as Partial<ComfyNode> | null;
    if (!n || typeof n !== 'object' || typeof n.class_type !== 'string' || typeof n.inputs !== 'object' || n.inputs === null) {
      throw new Error(`Node "${id}" is not a valid API-format node (needs class_type and inputs).`);
    }
  }
  return obj as ComfyWorkflow;
}

export function findPlaceholders(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(ANY)) into.add(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) findPlaceholders(v, into);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) findPlaceholders(v, into);
  }
  return into;
}

/** Deep-copies `template`, filling placeholders. Throws on unknown or unfilled ones. */
export function fillWorkflow<T>(template: T, values: PlaceholderValues): T {
  const missing = new Set<string>();
  const lookup = (key: string): string | number | undefined => (values as Record<string, string | number | undefined>)[key];
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const whole = WHOLE.exec(v);
      if (whole) {
        const val = lookup(whole[1]);
        if (val === undefined) {
          missing.add(whole[1]);
          return v;
        }
        return val;
      }
      return v.replace(ANY, (_, key: string) => {
        const val = lookup(key);
        if (val === undefined) {
          missing.add(key);
          return `{{${key}}}`;
        }
        return String(val);
      });
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  const result = walk(template) as T;
  if (missing.size) {
    throw new Error(`The workflow uses placeholders without a value: ${[...missing].map((m) => `{{${m}}}`).join(', ')}`);
  }
  return result;
}

/** Ids of nodes that save or preview images (candidates for the output). */
export function imageOutputNodes(workflow: ComfyWorkflow): string[] {
  return Object.entries(workflow)
    .filter(([, n]) => /SaveImage|PreviewImage/i.test(n.class_type))
    .map(([id]) => id);
}
