import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Numbers every file needs without a name; anything else is a named constant (the project's no-magic-numbers rule).
const ALLOWED_NUMBERS = [-1, 0, 1, 2];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-magic-numbers": "off",
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: ALLOWED_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // constants modules are where the numbers are named
    files: ["lib/constants/**"],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
