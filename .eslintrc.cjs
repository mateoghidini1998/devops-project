module.exports = {
    root: true,
    env: {
        node: true,
        es2022: true,
        jest: true,
    },
    parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
    plugins: ['import'],
    extends: [
        'eslint:recommended',
        'plugin:import/recommended',
        'plugin:import/errors',
        'plugin:import/warnings',
        'prettier',
    ],
    rules: {
        'no-console': 'off',
        'import/no-unresolved': 'off',
    },
    ignorePatterns: ['node_modules/', 'coverage/', 'dist/'],
};


