module.exports = {
  root: true,
  ignorePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "frontend/**",
    "backend/**",
    "admin-teacher-assessment/**",
  ],
  overrides: [
    {
      files: ["server/**/*.ts"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      env: {
        node: true,
        es2022: true,
        jest: true,
      },
      rules: {},
    },
    {
      files: ["client/**/*.ts", "client/**/*.tsx"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      env: {
        browser: true,
        es2022: true,
        jest: true,
      },
      rules: {},
    },
  ],
};
