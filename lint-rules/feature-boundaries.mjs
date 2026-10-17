// apps/web features talk to each other only through their public index (plan §5b "apps/web layout"): code outside
// `features/<name>/` may import `@/features/<name>` (its index.ts) and nothing deeper. Inside a feature, its own files
// are free to import each other. Covers the `@/features/...` alias and relative paths that walk into another feature.
import path from "node:path";

const INDEX_FILE = /^index(\.[cm]?[jt]sx?)?$/;

/** The feature a path (relative to the features folder) belongs to, or null when it lies outside it. */
function featureOf(relative) {
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep)[0] ?? null;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "Import another apps/web feature only through its index.ts" },
    schema: [
      {
        type: "object",
        properties: { featuresDir: { type: "string" }, alias: { type: "string" } },
        required: ["featuresDir"],
        additionalProperties: false,
      },
    ],
    messages: {
      deep: 'Import the "{{feature}}" feature through its public index ("{{alias}}{{feature}}"), not "{{source}}".',
    },
  },
  create(context) {
    const { featuresDir, alias = "@/features/" } = context.options[0];
    const filename = context.filename;
    const own = featureOf(path.relative(featuresDir, filename));

    /** [feature, segments below it] for an import that lands in the features folder, else null. */
    const target = (source) => {
      if (source.startsWith(alias)) {
        const [feature = "", ...rest] = source.slice(alias.length).split("/");
        return [feature, rest];
      }
      if (!source.startsWith(".")) return null;
      const relative = path.relative(featuresDir, path.resolve(path.dirname(filename), source));
      const feature = featureOf(relative);
      return feature === null ? null : [feature, relative.split(path.sep).slice(1)];
    };

    const check = (sourceNode) => {
      if (sourceNode?.type !== "Literal" || typeof sourceNode.value !== "string") return;
      const found = target(sourceNode.value);
      if (!found) return;
      const [feature, rest] = found;
      if (feature === "" || feature === own) return;
      const throughIndex = rest.length === 0 || (rest.length === 1 && INDEX_FILE.test(rest[0]));
      if (!throughIndex) {
        context.report({ node: sourceNode, messageId: "deep", data: { feature, alias, source: sourceNode.value } });
      }
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
    };
  },
};
