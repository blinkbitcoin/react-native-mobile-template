import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: 'mocks/schema.graphql',
  documents: ['src/**/*.graphql'],
  ignoreNoDocuments: true,
  generates: {
    'src/graphql/generated/': {
      preset: 'client',
      presetConfig: { fragmentMasking: false },
      // `useTypeImports` keeps the generated files compatible with
      // `verbatimModuleSyntax` in tsconfig.json.
      config: { enumsAsTypes: true, skipTypename: false, useTypeImports: true },
    },
  },
};

export default config;
