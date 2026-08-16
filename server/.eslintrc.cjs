module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: false,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'commonjs',
  },
  rules: {
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-undef': 'error',
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-constant-condition': 'warn',
    'no-duplicate-imports': 'error',
    'no-unreachable': 'error',
  },
  ignorePatterns: ['data/', 'node_modules/', 'uploads/'],
};