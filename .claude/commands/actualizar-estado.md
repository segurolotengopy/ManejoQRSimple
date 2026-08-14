---
description: Actualiza docs/ESTADO.md al cerrar la sesión de trabajo
allowed-tools: Read, Edit, Bash(git status), Bash(git log:*), Bash(git diff:*)
---

Cierra la sesión actualizando @docs/ESTADO.md:

1. Actualiza la línea "Última actualización" con la fecha de hoy y un rótulo
   corto de la sesión.
2. Si el dueño tomó decisiones nuevas en esta sesión, agrégalas numeradas a
   "Decisiones transversales vigentes" (sin borrar las anteriores; si una
   decisión reemplaza a otra, márcala como reemplazada y por cuál).
3. Mueve a "Hecho" lo completado en esta sesión, con el detalle suficiente para
   retomar sin releer toda la conversación (qué, dónde, y cualquier valor no
   obvio: nombres de recursos, versiones fijadas, workarounds).
4. Reescribe "Próximo paso (retomar acá)" con acciones concretas y ordenadas,
   separando lo que hace el dueño de lo que hace Claude Code.
5. Verifica que NO haya secretos en lo que escribiste (nombres de recursos sí;
   tokens, llaves o rutas de storageState, no).

El archivo es la memoria del proyecto entre sesiones: escribe para el que
retoma en frío dentro de un mes.
