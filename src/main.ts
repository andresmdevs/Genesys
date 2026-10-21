/**
 * Entry point: owns the canvas, the scene the player is looking at, and the
 * fixed-timestep loop that drives the simulation.
 *
 * The loop advances the world at a fixed 30 Hz regardless of display refresh
 * rate, and renders as often as the browser will paint. That separation is
 * what keeps the offline game and the online server in step.
 */

import './style.css';

import type { ChampionDef } from './champions/types.ts';
import { CHAMPIONS, championsByRole, getChampion } from './champions/index.ts';
import { Rng } from './core/rng.ts';
import type { Vec2 } from './core/math.ts';
import { BLUE, RED, type Team } from './data/map.ts';
import { Camera } from './render/camera.ts';
import { drawMinimap, minimapToWorld } from './render/minimap.ts';
import { render, type RenderState } from './render/renderer.ts';
import { Input } from './input/input.ts';
import type { Command } from './sim/commands.ts';
import { LocalDriver, type Driver } from './sim/driver.ts';
import { LockstepDriver } from './net/lockstep.ts';
import type { RoomLink } from './net/client.ts';
import { Match, type MatchConfig, type SlotConfig } from './sim/match.ts';
import type { AbilityKey, ChampionRole, Unit } from './sim/types.ts';
import {
  DEFAULT_POSITION_FOR_ROLE,
  POSITIONS,
  slotFor,
  type Position,
} from './sim/positions.ts';
import { Hud } from './ui/hud.ts';
import { Scoreboard } from './ui/scoreboard.ts';
import { Shop } from './ui/shop.ts';
import { championSelect, endScreen, helpPanel, mainMenu } from './ui/screens.ts';

type Scene = 'menu' | 'select' | 'playing' | 'end';

/**
 * Builds a full ten-champion roster around the player's pick.
 *
 * Each of the five positions gets one champion per side, drawn from the pair
 * that suits it, so every champion appears exactly once.
 */
export function buildRoster(
  player: ChampionDef,
  seed: number,
  playerName = 'Tú',
  playerPosition?: Position,
): SlotConfig[] {
  const rng = new Rng(seed);
  const names = ['Arden', 'Brisa', 'Cairo', 'Duna', 'Eris', 'Faro', 'Gala', 'Hilo', 'Ira'];
  const mine = playerPosition ?? DEFAULT_POSITION_FOR_ROLE[player.role];

  // Which champion pair feeds which position.
  const roleFor: Record<Position, ChampionRole> = {
    top: 'top',
    jungle: 'mid',
    mid: 'mage',
    adc: 'adc',
    support: 'support',
  };

  const taken = new Set<string>([player.id]);
  const pickFree = (position: Position): ChampionDef => {
    const pool = championsByRole(roleFor[position]).filter((c) => !taken.has(c.id));
    const fallback = CHAMPIONS.filter((c) => !taken.has(c.id));
    const choices = pool.length > 0 ? pool : fallback;
    const def = choices[rng.int(0, Math.max(0, choices.length - 1))] ?? CHAMPIONS[0];
    taken.add(def.id);
    return def;
  };

  const slots: SlotConfig[] = [];
  let botName = 0;
  for (const team of [BLUE, RED] as Team[]) {
    for (const position of POSITIONS) {
      const isPlayer = team === BLUE && position === mine;
      const def = isPlayer ? player : pickFree(position);
      slots.push({
        slot: slotFor(team, position),
        championId: def.id,
        team,
        position,
        isBot: !isPlayer,
        displayName: isPlayer ? playerName : names[botName++ % names.length],
      });
    }
  }
  return slots.sort((a, b) => a.slot - b.slot);
}

class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly ui: HTMLElement;
  readonly camera = new Camera();

  private scene: Scene = 'menu';
  private screen: HTMLElement | null = null;
  match: Match | null = null;
  playerSlot = -1;
  private driver: Driver | null = null;
  private net: RoomLink | null = null;
  private lastPick: ChampionDef = CHAMPIONS[0];
  private lastPosition: Position = 'mid';

  private hud: Hud | null = null;
  private shop: Shop | null = null;
  private scoreboard: Scoreboard | null = null;
  private readonly help: HTMLElement;
  private input: Input | null = null;

  private mouse: Vec2 = { x: 0, y: 0 };
  private lastFrame = performance.now();
  private quickCast = false;
  private pending: Command[] = [];

  constructor() {
    this.canvas = document.getElementById('game') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    this.ui = document.getElementById('ui') as HTMLElement;
    this.help = helpPanel(this.ui);

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.showMenu();
    requestAnimationFrame((t) => this.frame(t));
  }

  /* ---------------------------------------------------------------- *
   * Scenes
   * ---------------------------------------------------------------- */

  private clearScreen(): void {
    this.screen?.remove();
    this.screen = null;
  }

  private showMenu(): void {
    this.teardownMatch();
    this.clearScreen();
    this.scene = 'menu';
    this.screen = mainMenu(this.ui, {
      onPractice: () => this.showSelect(),
      onOnline: () => this.startOnline(),
      onHelp: () => this.help.classList.toggle('hidden'),
    });
  }

  private showSelect(): void {
    this.clearScreen();
    this.scene = 'select';
    this.screen = championSelect(
      this.ui,
      ({ champion, position }) => this.startPractice(champion, position),
      () => this.showMenu(),
    );
  }

  private startOnline(): void {
    void import('./net/online.ts').then((mod) => {
      this.clearScreen();
      this.screen = mod.onlineScreen(this.ui, {
        onCancel: () => this.showMenu(),
        onStart: (champion, seed, slots, slot, net) =>
          this.startMatch({ seed, slots }, slot, champion, net),
      });
    });
  }

  private startPractice(champion: ChampionDef, position?: Position): void {
    this.lastPick = champion;
    this.lastPosition = position ?? DEFAULT_POSITION_FOR_ROLE[champion.role];
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const slots = buildRoster(champion, seed, 'Tú', this.lastPosition);
    const mine = slots.find((s) => !s.isBot)!;
    this.startMatch({ seed, slots }, mine.slot, champion);
  }

  private startMatch(
    config: MatchConfig,
    slot: number,
    champion: ChampionDef,
    net: RoomLink | null = null,
  ): void {
    this.clearScreen();
    this.teardownMatch();

    this.lastPick = champion;
    this.match = new Match(config);
    this.playerSlot = slot;
    this.scene = 'playing';
    this.net = net;

    if (net) {
      const lockstep = new LockstepDriver(this.match, net);
      // The lobby's handlers are replaced now that the match owns the socket.
      net.handlers = {
        onLobby: () => {},
        onStart: () => {},
        onTick: (tick, cmds) => lockstep.receiveBundle(tick, cmds),
        onDropped: (droppedSlot, tick) => lockstep.receiveDrop(droppedSlot, tick),
        onClosed: (reason) => {
          this.hud?.toast(`Conexión perdida: ${reason}`);
          // The match keeps running offline so the player is not kicked out
          // mid-fight; the remaining humans become bots on their drop tick.
          this.net = null;
          this.driver = new LocalDriver(this.match!);
        },
        onError: (message) => this.hud?.toast(message),
      };
      this.driver = lockstep;
    } else {
      this.driver = new LocalDriver(this.match);
    }

    const player = this.match.championOf(slot);
    if (player) this.camera.snapTo(player.pos);
    this.camera.locked = true;

    this.hud = new Hud(this.ui, {
      onAbility: (key) => this.armAbility(key),
      onLevelUp: (key) => this.sendLevelUp(key),
      onToggleShop: () => this.shop?.toggle(),
      onToggleQuickCast: () => this.setQuickCast(!this.quickCast),
      onToggleHelp: () => this.help.classList.toggle('hidden'),
      onToggleCameraLock: () => {
        this.camera.locked = !this.camera.locked;
        this.hud?.setCameraLocked(this.camera.locked);
      },
    });
    this.hud.setQuickCast(this.quickCast);

    this.shop = new Shop(
      this.ui,
      (id) => this.pushCommand({ t: 'buy', slot: this.playerSlot, item: id }),
      (index) => this.pushCommand({ t: 'sell', slot: this.playerSlot, index }),
    );
    this.scoreboard = new Scoreboard(this.ui);

    // Selling from the HUD item slots bubbles up as a custom event.
    this.hud.root.addEventListener('sell', (e) => {
      const index = (e as CustomEvent<number>).detail;
      this.pushCommand({ t: 'sell', slot: this.playerSlot, index });
    });

    this.input = new Input(this.canvas, this.camera, {
      cursorWorld: () => this.mouseWorld(),
      hoveredEnemy: () => this.hovered('enemy'),
      hoveredAlly: () => this.hovered('ally'),
      abilityTargeting: (key) => {
        const unit = this.playerUnit();
        if (!unit) return 'point';
        return getChampion(unit.champion!.championId)?.abilities[key].targeting ?? 'point';
      },
      slot: () => this.playerSlot,
      onToggleScoreboard: (show) => this.scoreboard?.setVisible(show),
      onToggleShop: () => this.shop?.toggle(),
      onToggleHelp: () => this.help.classList.toggle('hidden'),
      onCentreCamera: () => {
        const unit = this.playerUnit();
        if (unit) this.camera.snapTo(unit.pos);
      },
      onMinimapClick: (world) => {
        this.camera.locked = false;
        this.camera.snapTo(world);
        this.hud?.setCameraLocked(false);
      },
      canAim: (key) => {
        const unit = this.playerUnit();
        return Boolean(unit && this.match?.canCast(unit, key));
      },
      onAimChanged: (key) => {
        if (this.hud) this.hud.aiming = key;
      },
    });
    this.input.quickCast = this.quickCast;
    this.input.attachMinimap(this.hud.minimap, (x, y) =>
      minimapToWorld(this.hud!.minimap, x, y),
    );
  }

  private teardownMatch(): void {
    this.net?.close();
    this.net = null;
    this.driver = null;
    this.hud?.destroy();
    this.shop?.destroy();
    this.scoreboard?.destroy();
    this.hud = null;
    this.shop = null;
    this.scoreboard = null;
    this.input = null;
    this.match = null;
    this.playerSlot = -1;
  }

  private showEnd(): void {
    if (!this.match) return;
    const player = this.playerUnit();
    const champ = player?.champion;
    const won = this.match.world.winner === player?.team;
    const summary = {
      won,
      minutes: this.match.world.seconds / 60,
      kills: champ?.kills ?? 0,
      deaths: champ?.deaths ?? 0,
      assists: champ?.assists ?? 0,
      creepScore: champ?.creepScore ?? 0,
      damage: champ?.damageDealt ?? 0,
    };
    const pick = this.lastPick;
    this.teardownMatch();
    this.clearScreen();
    this.scene = 'end';
    this.screen = endScreen(
      this.ui,
      summary,
      () => this.startPractice(pick, this.lastPosition),
      () => this.showMenu(),
    );
  }

  /* ---------------------------------------------------------------- *
   * Player helpers
   * ---------------------------------------------------------------- */

  private mouseWorld(): Vec2 {
    return this.camera.pointerToWorld(this.mouse.x, this.mouse.y);
  }

  private playerUnit(): Unit | undefined {
    return this.playerSlot >= 0 ? this.match?.championOf(this.playerSlot) : undefined;
  }

  private playerTeam(): Team {
    return (this.playerUnit()?.team as Team) ?? BLUE;
  }

  private pushCommand(cmd: Command): void {
    this.pending.push(cmd);
  }

  private sendLevelUp(key: AbilityKey): void {
    if (this.playerSlot < 0) return;
    this.pushCommand({ t: 'levelUp', slot: this.playerSlot, key });
  }

  private armAbility(key: AbilityKey): void {
    const unit = this.playerUnit();
    if (!unit || !this.match?.canCast(unit, key)) return;
    if (this.quickCast) {
      const world = this.mouseWorld();
      this.pushCommand({
        t: 'cast',
        slot: this.playerSlot,
        key,
        x: world.x,
        y: world.y,
        target: this.hovered('enemy'),
      });
      return;
    }
    if (this.input) {
      const next = this.input.aiming === key ? null : key;
      this.input.aiming = next;
      if (this.hud) this.hud.aiming = next;
    }
  }

  private setQuickCast(on: boolean): void {
    this.quickCast = on;
    if (this.input) {
      this.input.quickCast = on;
      this.input.aiming = null;
    }
    if (this.hud) {
      this.hud.aiming = null;
      this.hud.setQuickCast(on);
    }
  }

  /**
   * Unit under the cursor, or -1. `side` restricts the search, because a right
   * click must only ever attack an enemy: letting a friendly turret answer the
   * query turns the click into an attack order that the simulation discards,
   * and the move never happens.
   */
  private hovered(side: 'enemy' | 'ally'): number {
    if (!this.match) return -1;
    const world = this.mouseWorld();
    const team = this.playerTeam();
    const playerId = this.playerUnit()?.id ?? -1;
    let best = -1;
    let bestScore = -Infinity;

    for (const unit of this.match.world.units.values()) {
      if (!unit.alive) continue;
      const friendly = unit.team === team;
      if (side === 'enemy') {
        // Neutral monsters count as enemies; allies never do.
        if (friendly) continue;
        if (!this.match.world.isVisibleTo(team, unit.id)) continue;
      } else {
        // Ally targeting is for champions; healing a minion helps nobody.
        if (!friendly || unit.kind !== 'champion') continue;
      }

      const dx = unit.pos.x - world.x;
      const dy = unit.pos.y - world.y;
      const d = Math.hypot(dx, dy);
      // A small, zoom-independent grab margin. Structures get none: their
      // radius is already large and a wide margin eats nearby ground clicks.
      const grab = unit.radius + (unit.isStatic ? 0 : 22 / this.camera.zoom);
      if (d > grab) continue;

      const score = (unit.kind === 'champion' ? 1000 : unit.isStatic ? 100 : 500) - d;
      if (score > bestScore) {
        bestScore = score;
        best = unit.id;
      }
    }

    // Ally-targeted spells fall back to the caster, never to nothing.
    if (side === 'ally' && best < 0) return playerId;
    return best;
  }

  /* ---------------------------------------------------------------- *
   * Loop
   * ---------------------------------------------------------------- */

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(this.canvas.width, this.canvas.height, dpr);
  }

  private frame(now: number): void {
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.scene === 'playing' && this.match && this.driver) {
      const fromInput = this.input ? this.input.drain() : [];
      if (this.pending.length > 0 || fromInput.length > 0) {
        this.driver.queue(this.pending.concat(fromInput));
        this.pending = [];
      }
      this.driver.advance(elapsed);

      const player = this.playerUnit();
      if (player) this.camera.follow(player.pos);
      this.edgeScroll(elapsed);

      this.drawGame();

      if (this.match.world.winner !== null) this.showEnd();
    } else {
      this.ctx.fillStyle = '#05070f';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    requestAnimationFrame((t) => this.frame(t));
  }

  private edgeScroll(elapsed: number): void {
    if (this.camera.locked) return;
    const margin = 24;
    const speed = 1100 * elapsed;
    let dx = 0;
    let dy = 0;
    if (this.mouse.x < margin) dx = speed;
    else if (this.mouse.x > window.innerWidth - margin) dx = -speed;
    if (this.mouse.y < margin) dy = speed;
    else if (this.mouse.y > window.innerHeight - margin) dy = -speed;
    if (dx !== 0 || dy !== 0) this.camera.pan(dx, dy);
  }

  private drawGame(): void {
    if (!this.match) return;
    const player = this.playerUnit();
    const team = this.playerTeam();
    const aimingKey = this.input?.aiming ?? null;

    let aiming: RenderState['aiming'] = null;
    if (aimingKey && player) {
      const def = getChampion(player.champion!.championId)?.abilities[aimingKey];
      if (def) {
        aiming = {
          key: aimingKey,
          range: this.match.abilityRange(player, aimingKey),
          radius: def.indicatorRadius ?? 0,
          width: def.indicatorWidth ?? 70,
          targeting: def.targeting,
        };
      }
    }

    render(this.ctx, this.match, this.camera, {
      team,
      playerId: player?.id ?? -1,
      aiming,
      cursorWorld: this.mouseWorld(),
      hoveredUnitId: this.hovered('enemy'),
      showRanges: true,
    });

    this.hud?.update(this.match, player, team);
    this.hud?.setNetworkStalled(this.driver?.waiting ?? false);
    this.scoreboard?.update(this.match, player?.id ?? -1);
    this.shop?.update(player, Boolean(player && this.match.canShop(player)));
    if (this.hud) {
      drawMinimap(this.hud.minimap, this.match, this.camera, team, player?.id ?? -1);
    }
  }
}
const game = new Game();

// Exposed so the browser smoke tests can inspect the running match. Harmless
// in production: it is a read handle, not a control surface.
(window as unknown as { genesys?: unknown }).genesys = game;
