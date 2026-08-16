module.exports = {
  env: {
    browser: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: '18.3',
    },
  },
  plugins: ['react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
    'no-undef': 'error',
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-constant-condition': 'warn',
    'no-duplicate-imports': 'error',
    'no-unreachable': 'error',
    'react/no-unescaped-entities': 'off',
  },
  overrides: [
    {
      files: ['*.config.js', 'postcss.config.js', 'tailwind.config.js'],
      env: {
        node: true,
        es2022: true,
      },
      parserOptions: {
        sourceType: 'commonjs',
      },
    },
    {
      files: ['vite.config.js'],
      env: {
        node: true,
        es2022: true,
      },
      parserOptions: {
        sourceType: 'module',
      },
    },
    {
      files: ['scripts/*.js'],
      env: {
        node: true,
        es2022: true,
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', '__prerendered__/', 'scripts/'],
};