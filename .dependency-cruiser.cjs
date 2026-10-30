/** Layer rules: config <- engine <- (schemas) <- api / components. Engine stays pure. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'config-is-a-leaf',
      severity: 'error',
      from: { path: '^src/config' },
      to: { path: '^src/(engine|schemas|api|components)' },
    },
    {
      name: 'engine-is-pure',
      severity: 'error',
      from: { path: '^src/engine' },
      to: { path: '^src/(schemas|api|components)' },
    },
    {
      name: 'engine-no-runtime-deps',
      severity: 'error',
      from: { path: '^src/engine' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-peer', 'npm-optional'] },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      from: { orphan: true, pathNot: '\\.d\\.ts$' },
      to: {},
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
  },
};
