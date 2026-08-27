// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', 'node_modules/**', '**/*.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Un solo programa con todo el repo (tests incluidos), igual que
        // `npm run typecheck` — así las reglas con tipos ven lo mismo que tsc.
        project: ['./tsconfig.typecheck.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Regla de negocio #11: nunca `any`. El proyecto la trata como error,
      // no como aviso — el gate corre con --max-warnings=0 de todos modos.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // Un parámetro con `_` adelante está ahí por la firma de la interfaz,
      // no por descuido: implementarla obliga a declararlo aunque no se use.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Regla de negocio #10: aleatoriedad criptográfica, nunca Math.random().
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Regla #10: usá crypto.randomInt() / crypto.randomBytes(), nunca Math.random().',
        },
      ],
    },
  },
  {
    // Los archivos de configuración en JS/MJS no forman parte del programa de
    // TypeScript, así que las reglas con tipos no aplican sobre ellos.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly' },
    },
  },
  {
    // Los tests pueden construir datos deliberadamente inválidos para probar
    // que el borde los rechaza; ahí las reglas de tipos "unsafe" estorban.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
