# Genesys

MOBA 5 contra 5 de código abierto que corre en una pestaña del navegador. Tres
carriles, torres, oleadas de súbditos, jungla, dragón y barón, tienda de
objetos y diez campeones originales. Sin descargas, sin cuenta y sin motor de
terceros: todo es TypeScript y un `<canvas>`.

> **Sobre la inspiración.** Genesys toma prestadas las *mecánicas* del género
> (las reglas de un juego no son propiedad intelectual), pero **no usa ningún
> nombre, arte, texto ni dato de Riot Games**. Los diez campeones, el mapa y
> los objetos son originales. Este proyecto no está afiliado a Riot Games.

## Jugar

Una vez desplegado en GitHub Pages, el juego vive en
`https://<tu-usuario>.github.io/Genesys/`.

En local:

```bash
npm install
npm run dev
```

## Qué hay dentro

- **Mapa con simetría real.** Solo se escribe a mano la mitad azul; la roja se
  genera reflejando sobre la antidiagonal, así que ningún lado puede tener
  ventaja por un descuido. El terreno es una unión de discos y cápsulas que
  consumen *a la vez* la rejilla de navegación y el renderizador, de modo que
  lo que se ve y lo que se puede pisar nunca divergen.
- **Simulación determinista y sin DOM.** Paso fijo a 30 Hz. La misma semilla
  reproduce la misma partida exactamente. Eso es lo que permite que el
  multijugador funcione en lockstep sin enviar estado por la red.
- **Súbditos, torres, inhibidores y núcleo** con las reglas de prioridad del
  género: las torres defienden a quien está siendo atacado, las oleadas se
  enfadan contigo si golpeas a un campeón aliado, y las estructuras caen de
  fuera hacia dentro.
- **Diez campeones**, dos por rol, cada uno con pasiva y cuatro habilidades:
  proyectiles, zonas, desplazamientos, escudos, curaciones y control de masas.
- **Economía completa**: oro por último golpe, experiencia compartida,
  recompensas por asesinato con rachas, 29 objetos con rutas de construcción y
  crédito por componentes.
- **Jungla y objetivos**: doce campamentos con reaparición, dragón con cuatro
  elementos y acumulaciones permanentes, y barón con potenciador temporal que
  también refuerza tus oleadas.
- **Bots que juegan de verdad**: farmean, respetan las torres, se retiran
  heridos, vuelven a base, compran objetos siguiendo su guía, se agrupan y
  cierran la partida.
- **Multijugador online en lockstep** con relleno de bots si la sala no se
  llena en cinco minutos.

## Controles

| Tecla | Acción |
| --- | --- |
| Clic derecho | Mover, atacar o seguir |
| `Q` `W` `E` `R` | Lanzar habilidad (clic izquierdo para confirmar) |
| `Mayús`/`Ctrl` + `QWER` | Subir de rango la habilidad |
| `A` + clic | Mover atacando |
| `S` | Detenerse |
| `B` | Volver a la base |
| `D` / `F` | Destello / Curación |
| `P` | Tienda (solo en la base) |
| `Tab` | Marcador |
| `Espacio` | Centrar la cámara |
| `Y` | Fijar o soltar la cámara |
| `G` | Señalar en el mapa |
| Rueda | Acercar o alejar |
| `F1` | Ayuda |

También hay un interruptor de **tiro rápido** para lanzar directamente desde la
tecla, sin confirmar con el clic.

## Los campeones

| Rol | Campeón | Idea |
| --- | --- | --- |
| Línea superior | **Kórvath**, el Yunque Viviente | Se endurece cuanto más lo golpean |
| Línea superior | **Mordrax**, el Hambre Carmesí | Gana los duelos largos curándose |
| Asesino | **Vael**, la Hoja Silente | Marca, revienta y reinicia al matar |
| Asesino | **Nyx**, el Eco del Vacío | Acumula veneno y lo detona de golpe |
| Mago | **Ysolde**, Corazón de Escarcha | Niega terreno y parte las peleas |
| Mago | **Pyrrhen**, la Llama Devoradora | Todo lo que toca arde |
| Tirador | **Ryka**, Puntería Perfecta | Daño sostenido si sobrevive |
| Tirador | **Thessa**, la Cazadora de Brumas | Castiga desde fuera de alcance |
| Soporte | **Lumen**, Guardián del Alba | Cura, escuda y acelera |
| Soporte | **Grommar**, el Muro de Piedra | Un enganche y empieza la pelea |

## Arquitectura

```
src/
  core/        matemáticas y generador aleatorio con semilla
  data/        geometría del mapa y catálogo de objetos
  sim/         la simulación: mundo, combate, movimiento, partida, bots
  champions/   los diez kits, sobre una capa de ayudas compartida
  render/      cámara, terreno, renderizador y minimapa
  ui/          HUD, tienda, marcador y pantallas
  input/       ratón y teclado
  net/         protocolo, cliente, lockstep y emparejamiento
server/        servidor de salas (Cloudflare Workers o Node)
```

La regla que sostiene todo lo demás: **`src/sim` no toca el DOM**. La misma
clase `Match` corre dentro de una pestaña para la práctica contra la IA y
dentro de cualquier cliente de una partida online, tick a tick, con el mismo
resultado.

### Por qué lockstep

Como la simulación es determinista (y hay una prueba que lo verifica), los
clientes no necesitan intercambiar estado del mundo: basta con ponerse de
acuerdo en **qué órdenes se aplican en qué tick**. El servidor solo reparte
esas órdenes, nunca simula nada, y por eso cabe en el plan gratuito de
cualquier proveedor. El coste es un retraso de entrada fijo de cuatro ticks
(unos 130 ms); la ventaja es que la desincronización es imposible mientras la
simulación siga siendo determinista.

## Desarrollo

```bash
npm run dev        # servidor de desarrollo
npm run build      # typecheck + build de producción
npm test           # pruebas de la simulación, el mapa y los bots
```

Pruebas en navegador real (necesitan `npm run build && npm run preview`):

```bash
node scripts/smoke.mjs      # recorre las pantallas y detecta errores de consola
node scripts/playtest.mjs   # juega de verdad: moverse, farmear, lanzar, comprar
node scripts/mp-test.mjs    # dos navegadores en la misma sala, comprueba la sincronía
```

## Despliegue

**El juego** se publica solo: cada empujón a `main` dispara el flujo de
`.github/workflows/deploy.yml`, que compila y publica en GitHub Pages. Activa
Pages en *Settings → Pages → Source: GitHub Actions*.

Si alojas el juego en la raíz de un dominio en vez de en `/Genesys/`, compila
con `BASE_PATH=/ npm run build`.

**El servidor de salas** es opcional y solo hace falta para el modo online.
Las instrucciones están en [`server/README.md`](server/README.md).

## Licencia

MIT. Haz con esto lo que quieras.
