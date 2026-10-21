# Servidor de salas de Genesys

Empareja jugadores y retransmite órdenes. **No simula la partida**: los
clientes llevan simulaciones deterministas idénticas y el servidor solo decide
qué órdenes van en qué tick. Por eso ocupa poco más de doscientas líneas y
cabe de sobra en un plan gratuito.

Qué hace:

1. Acepta hasta diez jugadores en una sala y reparte los puestos alternando
   equipos, para que se llenen parejos.
2. Espera cinco minutos. Si todos los presentes marcan *listo* antes, empieza
   ya.
3. Al arrancar envía la semilla y quién eligió qué. **Los puestos vacíos los
   ocupan bots**, que cada cliente genera a partir de esa misma semilla.
4. Retransmite un paquete de órdenes por tick, treinta veces por segundo.
5. Si alguien se desconecta, avisa del tick exacto en que su campeón pasa a
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

Nota: el reloj de la partida usa `setInterval` dentro del Durable Object, que
sigue vivo mientras haya sockets abiertos. Cuando se va el último jugador, el
reloj se detiene y la sala desaparece.

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

- Los puestos se reparten alternando equipos, así que dos amigos que entren
  seguidos caen en bandos contrarios. Falta un sistema de grupo.
- Un cliente muy lento retrasa a los demás: es la contrapartida del lockstep.
  El juego muestra «Esperando a la red…» mientras ocurre.
- No hay reconexión: si te caes, tu campeón lo llevan los bots hasta el final.
