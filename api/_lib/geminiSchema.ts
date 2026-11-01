import '../../src/schemas/zodRuntime.js';

/**
 * The bridge between the app's zod contracts and the provider's JSON-mode wire format:
 * it derives a provider response schema from a zod schema (object/string/number/array/
 * boolean/enum/literal/union/null), extracts the reply text, and normalises the reply so
 * one flexible wire format still validates strictly (nullable fields the provider omitted
 * become explicit nulls; unions are matched by their `type` literal tag).
 */

/**
 * Runtime view of a zod v4 schema node. Only the def fields this module reads are typed;
 * zod v4 keeps literals in `def.values` and enums in `def.entries`.
 */
interface ZodSchema {
  readonly def: ZodDef;
}
interface ZodDef {
  readonly type: string;
  readonly shape?: Record<string, ZodSchema>;
  readonly element?: ZodSchema;
  readonly innerType?: ZodSchema;
  readonly options?: readonly ZodSchema[];
  readonly entries?: Record<string, unknown>;
  readonly values?: readonly unknown[];
}

export function asZod(value: unknown): ZodSchema {
  return value as ZodSchema;
}

function isOptionalish(node: ZodSchema): boolean {
  return node.def.type === 'optional' || node.def.type === 'nullable';
}

function enumValues(def: ZodDef): unknown[] {
  // zod v4 enums carry `entries` (a record of string -> value); literals carry `values`.
  const raw = def.entries ?? [];
  return Array.isArray(raw) ? [...raw] : Object.values(raw);
}

function unwrapInner(def: ZodDef): Record<string, unknown> {
  return def.innerType === undefined ? { type: 'string' } : toResponseSchema(def.innerType);
}

/** Builds a JSON-mode response schema from a zod schema (object/string/number/array/boolean/enum/literal/union/null). */
export function toResponseSchema(node: ZodSchema): Record<string, unknown> {
  const def = node.def;
  switch (def.type) {
    case 'object':
      return objectToResponseSchema(def.shape ?? {});
    case 'array': {
      if (def.element === undefined) return { type: 'string' };
      return { type: 'array', items: toResponseSchema(def.element) };
    }
    case 'string':
      return { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
    case 'literal':
      return { type: 'string', enum: enumValues(def) };
    case 'union':
      return { anyOf: (def.options ?? []).map(toResponseSchema) };
    case 'nullable':
      return { ...unwrapInner(def), nullable: true };
    case 'optional':
      return unwrapInner(def);
    default:
      return { type: 'string' };
  }
}

function objectToResponseSchema(shape: Record<string, ZodSchema>): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, child] of Object.entries(shape)) {
    properties[name] = toResponseSchema(child);
    // The provider rejects schemas where a nullable field is also required, so nullable
    // fields stay optional; fillNullables() re-adds explicit nulls before zod validation.
    if (!isOptionalish(child)) required.push(name);
  }
  return { type: 'object', properties, required, propertyOrdering: Object.keys(properties) };
}

/** Shape of the provider's JSON reply; only the fields we read are modelled. */
export interface GenerateContentReply {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly error?: { readonly message?: string };
}

export function extractText(reply: GenerateContentReply): string {
  const parts = reply.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (text.length === 0 && reply.promptFeedback?.blockReason !== undefined) {
    throw new Error('AI_RESPONSE_INVALID');
  }
  return text;
}

export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error('AI_RESPONSE_INVALID');
  }
}

/**
 * The provider may omit a nullable field entirely; the zod contract wants an explicit null.
 * Walks the value against the schema and injects null for missing nullable keys, so one
 * flexible wire format still validates strictly. Unions are matched by their `type` literal.
 */
export function fillNullables(value: unknown, node: ZodSchema): unknown {
  const def = node.def;
  switch (def.type) {
    case 'object':
      return fillObject(value, def.shape ?? {});
    case 'array': {
      const element = def.element;
      if (element === undefined || !Array.isArray(value)) return value;
      return value.map((item) => fillNullables(item, element));
    }
    case 'nullable': {
      const inner = def.innerType;
      if (value === undefined || value === null || inner === undefined) return value;
      return fillNullables(value, inner);
    }
    case 'union':
      return fillUnion(value, def.options ?? []);
    default:
      return value;
  }
}

function fillObject(value: unknown, shape: Record<string, ZodSchema>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [name, child] of Object.entries(shape)) {
    if (out[name] === undefined) {
      if (child.def.type === 'nullable') out[name] = null;
      continue;
    }
    out[name] = fillNullables(out[name], child);
  }
  return out;
}

/** A union member is chosen by its `type` literal tag, matching the patch action shapes. */
function fillUnion(value: unknown, options: readonly ZodSchema[]): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const tag = (value as Record<string, unknown>).type;
  for (const option of options) {
    const tagValues = option.def.shape?.type?.def.values;
    if (tagValues !== undefined && tagValues[0] === tag) {
      return fillNullables(value, option);
    }
  }
  return value;
}
