import { configDefaults, defineConfig, defineProject } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'test/simulator-*.test.ts'],
          environment: 'node',
          globalSetup: ['./test/global-setup.ts'],
        },
      }),
      defineProject({
        test: {
          name: 'simulator',
          include: ['test/simulator-*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          maxConcurrency: 1,
          globalSetup: ['./test/global-setup.ts'],
        },
      }),
    ],
  },
});
