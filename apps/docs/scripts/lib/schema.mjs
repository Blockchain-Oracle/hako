/**
 * An endpoint's input JSON Schema (Pydantic's validation schema) as a field table: type, required, constraints and
 * default per field, then a table for each nested object type it references (e.g. groq/extract's FieldSpec).
 */

import { code, codeCell, mdCell, mdText, table } from "./markdown.mjs";

const HEADERS = ["Field", "Type", "Required", "Description"];

function defName(ref) {
  return ref.split("/").pop();
}

/** Inline a `$ref` (Pydantic puts `default` and `description` next to it, so the local keys win). */
function resolve(schema, defs) {
  if (!schema?.$ref) return schema ?? {};
  const name = defName(schema.$ref);
  const local = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref"));
  return { ...defs[name], ...local, defName: name };
}

/** The non-null shapes a field accepts (`anyOf: [X, null]` is how Pydantic writes "optional X"). */
function variants(schema, defs) {
  const field = resolve(schema, defs);
  if (!field.anyOf) return [field];
  return field.anyOf.map((v) => resolve(v, defs)).filter((v) => v.type !== "null");
}

function isObject(shape) {
  return shape.type === "object" || Boolean(shape.properties);
}

function typeLabel(shape, defs) {
  if (shape.type === "array") {
    const items = variants(shape.items, defs);
    return `array of ${items.map((i) => typeLabel(i, defs)).join(" or ") || "any"}`;
  }
  if (isObject(shape)) return shape.defName ? `object (${shape.defName})` : "object";
  if (shape.enum) return shape.type ?? "string";
  if (shape.format) return `${shape.type} (${shape.format})`;
  return shape.type ?? "any";
}

function range(min, max, unit) {
  const suffix = unit ? ` ${unit}` : "";
  if (min !== undefined && max !== undefined) return unit ? `${min}–${max}${suffix}.` : `From ${min} to ${max}.`;
  if (max !== undefined) return `At most ${max}${suffix}.`;
  if (min !== undefined) return `At least ${min}${suffix}.`;
  return null;
}

function constraints(shape, defs) {
  const out = [];
  if (shape.enum) out.push(`One of ${shape.enum.map((v) => code(v)).join(", ")}.`);
  out.push(range(shape.minLength, shape.maxLength, "characters"));
  if (shape.pattern) out.push(`Pattern ${code(shape.pattern)}.`);
  out.push(range(shape.minimum, shape.maximum));
  if (shape.exclusiveMinimum !== undefined) out.push(`Greater than ${shape.exclusiveMinimum}.`);
  if (shape.type === "array") {
    out.push(range(shape.minItems, shape.maxItems, "items"));
    for (const item of variants(shape.items, defs)) {
      const inner = constraints(item, defs).filter(Boolean);
      if (inner.length > 0 && !isObject(item)) out.push(`Each item: ${inner.join(" ")}`);
    }
  }
  return out.filter(Boolean);
}

/** Fields named by a top-level anyOf / oneOf ("a zone or a place"): they are conditionally required. */
function alternatives(schema) {
  const options = schema.oneOf ?? schema.anyOf;
  if (!options) return null;
  const groups = options.map((o) => o.required ?? []).filter((g) => g.length > 0);
  if (groups.length === 0) return null;
  const phrase = groups.map((g) => g.map((f) => code(f)).join(" and ")).join(", or ");
  const rule = schema.oneOf ? `Give exactly one of: ${phrase}.` : `Give at least one of: ${phrase}.`;
  return { rule, fields: new Set(groups.flat()) };
}

function requiredLabel(name, required, alt) {
  if (required.has(name)) return "yes";
  return alt?.fields.has(name) ? "see note" : "no";
}

function describe(prop, shapes, defs) {
  const parts = [];
  if (prop.description) parts.push(prop.description);
  for (const shape of shapes) parts.push(...constraints(shape, defs));
  if (prop.default !== undefined && prop.default !== null) parts.push(`Default ${code(JSON.stringify(prop.default))}.`);
  return parts.join(" ");
}

/** Object types this field points at, by name: rendered as their own tables after the main one. */
function nestedObjects(shapes, defs) {
  const found = [];
  for (const shape of shapes) {
    const candidates = shape.type === "array" ? variants(shape.items, defs) : [shape];
    for (const c of candidates) if (isObject(c) && c.defName && c.properties) found.push(c);
  }
  return found;
}

function fieldTable(schema, defs, alt) {
  const required = new Set(schema.required ?? []);
  const nested = new Map();
  const rows = Object.entries(schema.properties ?? {}).map(([name, raw]) => {
    const prop = resolve(raw, defs);
    const shapes = variants(raw, defs);
    for (const obj of nestedObjects(shapes, defs)) nested.set(obj.defName, obj);
    const type = shapes.map((s) => typeLabel(s, defs)).join(" or ");
    return [codeCell(name), mdCell(type), requiredLabel(name, required, alt), mdCell(describe(prop, shapes, defs))];
  });
  return { rows, nested };
}

/** Markdown for one endpoint's input: an optional summary line, the rule for alternatives, and the tables. */
export function inputSection(schema) {
  const defs = schema.$defs ?? {};
  const alt = alternatives(schema);
  const blocks = [];
  if (schema.description) blocks.push(mdText(schema.description));
  if (alt) blocks.push(alt.rule);
  const { rows, nested } = fieldTable(schema, defs, alt);
  if (rows.length === 0) {
    blocks.push("No input fields: send `{}`.");
    return blocks.join("\n\n");
  }
  blocks.push(table(HEADERS, rows));
  for (const [name, obj] of nested) {
    blocks.push(`Each ${code(name)} object:`);
    blocks.push(table(HEADERS, fieldTable(obj, defs, null).rows));
  }
  return blocks.join("\n\n");
}
