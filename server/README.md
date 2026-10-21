# Servidor de salas de Genesys

**Casi nadie necesita esto.** El juego trae partidas por código de sala: un
navegador hace de anfitrión y los demás se conectan directamente a él, sin
cuenta y sin desplegar nada. Este servidor es para cuando eso no basta:

- redes que bloquean las conexiones directas entre pares;
- partidas públicas donde la gente no se conoce;
- que la sala siga viva aunque el anfitrión cierre la pestaña.

Empareja jugadores y retransmite órdenes. **No simula la partida**: los
clientes llevan simulaciones deterministas idénticas y el servidor solo decide
qué órdenes van en qué tick. Por eso ocupa poco más de doscientas líneas y
cabe de sobra en un plan gratuito.

Qué hace:

1. Acepta hasta diez jugadores en una sala y reparte los puestos alternando
   equipos, para que se llenen parejos.
2. Cada jugador toma el puesto que quiera: equipo azul o rojo y posición
   (superior, jungla, central, tirador o soporte).
3. Espera cinco minutos. Si todos los presentes marcan *listo* antes, empieza
   ya.
4. Al arrancar envía la semilla y quién eligió qué. **Los puestos vacíos los
   ocupan bots**, que cada cliente genera a partir de esa misma semilla.
5. Retransmite un paquete de órdenes por tick, treinta veces por segundo.
6. Si alguien se desconecta, avisa del tick exacto en que su campeón pasa a
   manos de la IA, de modo que todos los clientes lo hagan a la vez.

Las órdenes se sellan con el puesto de quien las envía, así que un cliente no
puede mover el campeón de otro.

## Opción A: Cloudflare Workers (recomendada)

Cada sala es un Durable Object: el vestíbulo, el reloj y el relevo viven en el
mismo objeto, sin base de datos ni estado externo.

```bash
cd server
npm install
npx wrangler login
npm run deploy
```

Al terminar, `wrangler` imprime la dirección. La del juego es esa misma con
`/ws`:

```
wss://genesys-rooms.<tu-cuenta>.workers.dev/ws
```

Pégala en la pantalla de **Partida online**. Se guarda en el navegador, así que
solo hay que hacerlo una vez.

Para fijarla en la compilación y que nadie tenga que escribirla:

```bash
VITE_GENESYS_SERVER=wss://genesys-rooms.<tu-cuenta>.workers.dev/ws npm run build
```

Notas sobre el plan gratuito:

- La migración declara `new_sqlite_classes`, que es la única clase de Durable
  Object que admite el plan gratuito. Si lo cambias a `new_classes` el
  despliegue fallará por facturación.
- El reloj de la partida usa `setInterval` dentro del Durable Object, que sigue
  vivo mientras haya sockets abiertos. Cuando se va el último jugador, el reloj
  se detiene y la sala desaparece.
- El plan gratuito da unas 100.000 peticiones y 13.000 GB·s diarios de Durable
  Objects, de sobra para partidas entre amigos. Confirma las cifras vigentes en
  la página de precios de Cloudflare antes de contar con ellas.

## Opción B: Node, en tu propia máquina

```bash
npm install ws
node server/node/server.mjs --port 8787
```

Y en el juego: `ws://localhost:8787/ws`.

Hace exactamente lo mismo que la versión de Cloudflare. Para producción, ponlo
detrás de un proxy con TLS y usa `wss://`: un navegador que sirve la página por
HTTPS no abre sockets en texto plano.

Variables de entorno:

| Variable | Por defecto | Para qué |
| --- | --- | --- |
| `PORT` | `8787` | Puerto de escucha |
| `LOBBY_WAIT` | `300` | Segundos antes de rellenar con bots |

## Salas

La dirección admite `?room=<nombre>`. Sin él, todo el mundo cae en
`public-1`, que es lo que hace que el emparejamiento funcione cuando hay poca
gente. Para jugar con amigos, compartid un nombre de sala propio.

## Límites conocidos

- Un cliente muy lento retrasa a los demás: es la contrapartida del lockstep.
  El juego muestra «Esperando a la red…» mientras ocurre.
- No hay reconexión: si te caes, tu campeón lo llevan los bots hasta el final.
