module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
  },
  ignorePatterns: ['node_modules/', 'data/', 'uploads/'],
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-inner-declarations': 'off',
    'no-unused-vars': 'warn',
  },
};
