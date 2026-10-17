// A module that starts with the "use client" directive is bundled for the browser: it may not import a server-only
// package (plan §5b import boundaries). Globs can't find these files, so the rule reads the directive itself; the
// folder-scoped no-restricted-imports bans in eslint.config.mjs cover the client-only folders on top of this.
// Type-only imports are erased at build time and stay allowed.

/** @param {import("estree").Program} program */
function isClientModule(program) {
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") return false;
    if (statement.directive === "use client") return true;
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: 'Forbid server-only packages in "use client" modules' },
    schema: [
      {
        type: "object",
        properties: { packages: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: { serverOnly: '"{{source}}" is server-only: a "use client" module cannot import it.' },
  },
  create(context) {
    const packages = context.options[0]?.packages ?? [];
    const isServerOnly = (source) =>
      source === "server-only" || packages.some((name) => source === name || source.startsWith(`${name}/`));
    let client = false;

    const check = (node, sourceNode) => {
      if (!client || node.importKind === "type" || node.exportKind === "type") return;
      if (sourceNode?.type !== "Literal" || typeof sourceNode.value !== "string") return;
      if (isServerOnly(sourceNode.value)) {
        context.report({ node: sourceNode, messageId: "serverOnly", data: { source: sourceNode.value } });
      }
    };

    return {
      Program(program) {
        client = isClientModule(program);
      },
      ImportDeclaration: (node) => check(node, node.source),
      ExportNamedDeclaration: (node) => check(node, node.source),
      ExportAllDeclaration: (node) => check(node, node.source),
      ImportExpression: (node) => check(node, node.source),
    };
  },
};
