const config = {
    verbose: true,
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]sx?$': 'babel-jest',
    },
    coverageThreshold: {
        global: {
            branches: 65,
            functions: 60,
            lines: 70,
            statements: 70,
        },
    },
};

module.exports = config;