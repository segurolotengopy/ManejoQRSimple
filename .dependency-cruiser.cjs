/**
 * Regla de dependencias del monorepo (CLAUDE.md · docs/01 §4), validada en CI.
 *
 * El objetivo no es estilo: es que la migración a APIs oficiales sea escribir
 * un adaptador y no re-arquitecturar (ADR-002), y que el conocimiento de cada
 * proveedor quede encapsulado en un solo paquete.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'qr-core-es-puro',
      severity: 'error',
      comment:
        'qr-core es dominio puro: no importa otros paquetes del monorepo ni ' +
        'librerías de npm. Lo externo entra por los puertos de src/ports/. ' +
        '(Los builtins de node — p. ej. node:crypto para la regla #10 — se ' +
        'permiten: no son I/O ni SDKs. Cualquier otra cosa es una violación.)',
      from: { path: '^packages/qr-core/' },
      to: {
        pathNot: '^packages/qr-core/',
        dependencyTypesNot: ['core'],
      },
    },
    {
      name: 'adaptador-no-importa-adaptador',
      severity: 'error',
      comment:
        'Ningún adaptador conoce a otro adaptador. Se comunican por el dominio, ' +
        'nunca entre sí.',
      from: { path: '^packages/(baneco-gateway|yape-scraper|wa-bridge)/' },
      to: {
        path: '^packages/(baneco-gateway|yape-scraper|wa-bridge)/',
        pathNot: '^packages/$1/',
      },
    },
    {
      name: 'playwright-solo-en-yape-scraper',
      severity: 'error',
      comment:
        'Nada fuera de yape-scraper conoce la consola del banco ni maneja un ' +
        'navegador. La regla vale esté Playwright instalado o no.',
      from: { pathNot: '^packages/yape-scraper/' },
      to: { path: 'node_modules/(playwright|playwright-core|@playwright)/' },
    },
    {
      name: 'api-baneco-solo-en-su-gateway',
      severity: 'error',
      comment:
        'Solo baneco-gateway conoce la API de Banco Económico: sus URLs, DTOs, ' +
        'cifrado y códigos de respuesta. functions puede importarlo porque es ' +
        'la raíz de composición que lo cablea a los puertos.',
      from: { pathNot: '^packages/(baneco-gateway|functions)/' },
      to: { path: '^packages/baneco-gateway/' },
    },
    {
      name: 'whatsappmodular-solo-en-wa-bridge',
      severity: 'error',
      comment:
        'Solo wa-bridge conoce WhatsAppModular; functions lo cablea como raíz ' +
        'de composición.',
      from: { pathNot: '^packages/(wa-bridge|functions)/' },
      to: { path: '^packages/wa-bridge/' },
    },
    {
      name: 'demo-web-sin-adaptadores',
      severity: 'error',
      comment:
        'La consola del comerciante consume la API HTTP; no importa adaptadores ' +
        'ni Cloud Functions, y no aloja lógica de negocio.',
      from: { path: '^packages/demo-web/' },
      to: {
        path: '^packages/(baneco-gateway|yape-scraper|wa-bridge|functions)/',
      },
    },
    {
      name: 'sin-ciclos',
      severity: 'error',
      comment: 'Un ciclo de dependencias rompe el orden de build y esconde acoplamiento.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sin-dependencias-irresolubles',
      severity: 'error',
      comment:
        'Un import que no resuelve suele ser un paquete faltante en package.json.',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(/dist/|\\.test\\.ts$)' },
    // Resuelve @mqs/* contra el código fuente (paths de tsconfig.typecheck.json),
    // para no exigir un build previo al chequeo de dependencias.
    tsConfig: { fileName: 'tsconfig.typecheck.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.mjs', '.cjs'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
