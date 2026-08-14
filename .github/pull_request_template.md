## Qué cambia

<!-- Una o dos frases. El "por qué" importa más que el "qué". -->

## Definición de terminado

- [ ] Tests nuevos que **fallan** si se revierte la implementación
- [ ] `npm run lint && npm run typecheck && npm test` en verde localmente
- [ ] `npm run deps:check` respeta la regla de dependencias entre paquetes
- [ ] Documentación actualizada si cambió un contrato, variable o procedimiento
- [ ] `.env.example` actualizado si hay variables nuevas
- [ ] `docs/ESTADO.md` actualizado si cambió una decisión o el próximo paso

## Seguridad

- [ ] Ningún camino permite `CONFIRMADO` sin detección del `PaymentWatcher`
- [ ] Ningún secreto real ni ruta de sesión bancaria en código, tests o fixtures
- [ ] El scraper sigue siendo estrictamente de solo lectura
- [ ] El webhook valida HMAC sobre raw body antes de parsear
- [ ] Datos bancarios/personales al mínimo; teléfonos enmascarados en logs

## Cómo se probó

<!-- Pasos concretos. Si tocaste el scraper: qué fixture, jamás la consola viva. -->
