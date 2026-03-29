import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      // shadcn/ui generated components — not hand-maintained, formatter handles style
      "src/components/ui/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Turned off — codebase uses `any` extensively for Supabase/eBay API responses
      // and edge function payloads where runtime shapes are unknown.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      // Turned off — missing-dep warnings in this codebase are all intentional patterns
      // to avoid infinite re-render loops (callbacks/effects that should fire once).
      "react-hooks/exhaustive-deps": "off",
    },
  },
);
