# Prompts de sesiones dedicadas — ManejoQRSimple

Cada archivo de esta carpeta es el prompt completo de un **frente de trabajo**:
se pega entero en una sesión nueva de Claude Code sobre este proyecto y esa
sesión trabaja solo en ese frente. La convención general está en
`~/Claude-Proyectos/prompts/LEEME.md`; lo que vale acá, resumido:

- El cliente o el caso es un **parámetro**, nunca el nombre del prompt.
- **Andres autoriza; Claude opera.** Ningún paso se le pasa a Andres para que
  lo corra a mano.
- **Un bloque = una rama = un PR**, en worktree propio.
- Cada bloque declara **qué se gana, qué cuesta y qué prueba lo cubre**.
- **Lo que NO se construye**, con su porqué, es parte del prompt.

## Índice

| Prompt | Frente | Estado |
| :--- | :--- | :--- |
| [`cobrador-contrato-para-consumidores.md`](./cobrador-contrato-para-consumidores.md) | Abrir el cobro por QR a **proyectos consumidores**: contrato estable para que otro producto pida un cobro, sepa cuándo se pagó y lo anule, sin conocer nada del banco. | Bloque 1 en curso (2026-09-19) |

Al cerrar un bloque se anota su avance en `docs/ESTADO.md`, no en esta tabla:
acá solo va si el frente sigue abierto o quedó cerrado.
