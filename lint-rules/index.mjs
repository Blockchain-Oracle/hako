// Hako's own ESLint rules (plugin namespace "hako" in eslint.config.mjs).
import featureBoundaries from "./feature-boundaries.mjs";
import noServerOnlyInClient from "./no-server-only-in-client.mjs";

export default {
  meta: { name: "eslint-plugin-hako" },
  rules: {
    "feature-boundaries": featureBoundaries,
    "no-server-only-in-client": noServerOnlyInClient,
  },
};
