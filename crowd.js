// crowd.js — what a crowd of animated figures costs on the headset.
//
//   ./build/three --assets ../tabletop-siege --script ../tabletop-siege/crowd.js
//   adb push ../tabletop-siege/figures/. /sdcard/Android/data/dev.threec3.quest/files/game/figures/
//   packaging/android/quest.sh push ../tabletop-siege/crowd.js
//   packaging/android/quest.sh logs | grep crowd
//
// 160 orcs march across a table at a welded wall, with 16 archers on it and 24
// swordsmen behind it. Stones break the wall open and the orcs come through the
// gap; an orc that gets past the wall starts again at the far end. Every five
// seconds it logs what the frame cost, and how many draw calls the figures took.

const HZ = 90;
const TABLE = 0.75;
const SCALE = 1 / 30;
const WALL_Z = -0.7;
const BRICK = 0.1;
const WALL_W = 16;
const WALL_H = 4;
const ORCS = 160;
const ARCHERS = 16;
const SWORDSMEN = 24;

// The orcs' capsule, about a 6 cm figure.
const RADIUS = 0.012;
const HEIGHT = 0.06;
const MOVE = { radius: RADIUS, height: HEIGHT, step: 0.015, slope: 50, snap: 0.02 };
const SPEED = 0.05;
const GOAL = [0, TABLE + HEIGHT / 2, -0.25];
// The walk clip covers about 1.56 m a cycle at full size.
const WALK_SPEED = 1.56 * SCALE;

const STONE_EVERY = 2.5;
const STONE_RADIUS = 0.03;

const scene = new three.Scene();
scene.background = 0x8aa4c0;
three.light.set([-0.5, -1, -0.4], 0.9);

const plain = new three.MeshLambertMaterial({});

function box(w, h, d, x, y, z, color) {
	const m = new three.Mesh(new three.BoxGeometry(w, h, d), plain);
	m.position.set(x, y, z);
	m.color = color;
	scene.add(m);
	return m;
}

const table = box(2.4, 0.1, 2.6, 0, TABLE - 0.05, -1.3, [0.36, 0.45, 0.28]);
three.physics.add(table, { shape: 'box', mass: 0, friction: 0.8 });
const floor = box(20, 0.1, 20, 0, -0.05, 0, [0.3, 0.3, 0.32]);
three.physics.add(floor, { shape: 'box', mass: 0, friction: 0.8 });

// The wall: bricks welded to the one below and the one beside. Rebuilt every
// REBUILD_EVERY seconds, timed, since the game wakes a whole ring the same way.
const REBUILD_EVERY = 30;
const brickShape = new three.BoxGeometry(BRICK, BRICK, BRICK);
const bricks = [];
const weldsOf = new Map();
function weld(a, b) {
	const id = three.physics.joint(a, b, { type: 'fixed', breakForce: 100 });
	weldsOf.get(a).push(id);
	weldsOf.get(b).push(id);
}
function buildWall() {
	const t = performance.now();
	for (const b of bricks) {
		three.physics.remove(b);
		scene.remove(b);
	}
	bricks.length = 0;
	weldsOf.clear();
	for (let y = 0; y < WALL_H; y++) {
		for (let x = 0; x < WALL_W; x++) {
			const b = new three.Mesh(brickShape, plain);
			const home = [(x - (WALL_W - 1) / 2) * BRICK, TABLE + (y + 0.5) * BRICK, WALL_Z];
			b.position.set(...home);
			const shade = 0.55 + 0.1 * ((x * 7 + y * 5) % 4) / 3;
			b.color = [shade, shade * 0.96, shade * 0.9];
			scene.add(b);
			three.physics.add(b, { shape: 'box', mass: 0.3, friction: 0.7, restitution: 0.05, angularDamping: 1 });
			b.home = home;
			weldsOf.set(b, []);
			if (x > 0) weld(bricks[bricks.length - 1], b);
			if (y > 0) weld(bricks[bricks.length - WALL_W], b);
			bricks.push(b);
		}
	}
	return performance.now() - t;
}
let rebuiltIn = buildWall();

// A stone breaks the welds round where it lands, the way the game's hits do.
const stones = [];
const stoneShape = new three.SphereGeometry(STONE_RADIUS, 10, 8);
three.onContact(({ type, a, b, point }) => {
	if (type !== 'start') return;
	const stone = stones.includes(a) ? a : stones.includes(b) ? b : null;
	if (!stone || stone.landed || !point) return;
	stone.landed = true;
	const [px, py, pz] = Array.isArray(point) ? point : [point.x, point.y, point.z];
	for (const brick of bricks) {
		const p = brick.position;
		if (Math.hypot(p.x - px, p.y - py, p.z - pz) > 0.16) continue;
		for (const id of weldsOf.get(brick)) three.physics.removeJoint(id);
		weldsOf.set(brick, []);
		three.physics.applyImpulse(brick, [0, 0.05, 0.25]);
	}
});

function throwStone(t) {
	const s = new three.Mesh(stoneShape, plain);
	s.color = [0.3, 0.3, 0.32];
	const from = [Math.sin(t * 1.7) * 0.8, TABLE + 0.4, -2.3];
	const to = [Math.sin(t * 2.9) * 0.6, TABLE + 0.08 + 0.25 * (0.5 + 0.5 * Math.cos(t * 3.7)), WALL_Z - 0.06];
	s.position.set(...from);
	scene.add(s);
	three.physics.add(s, { shape: 'sphere', mass: 1.5, friction: 0.6, restitution: 0.1 });
	// Ballistic: there in `flight` seconds.
	const flight = 0.3;
	const g = 9.81;
	three.physics.setVelocity(s, [
		(to[0] - from[0]) / flight,
		(to[1] - from[1]) / flight + 0.5 * g * flight,
		(to[2] - from[2]) / flight,
	]);
	stones.push(s);
	if (stones.length > 8) {
		const old = stones.shift();
		three.physics.remove(old);
		scene.remove(old);
	}
}

// The figures.
const kinds = {
	orc: three.load('figures/orc.glb'),
	archer: three.load('figures/archer.glb'),
	swordsman: three.load('figures/swordsman.glb'),
};

function figure(kind, x, z, heading, clip, speed = 1) {
	const f = kinds[kind].instantiate();
	f.scale.set(SCALE, SCALE, SCALE);
	f.position.set(x, TABLE, z);
	f.rotation.y = heading;
	// Out of every spatial query: moving 160 figures a frame made each sweep after it
	// cost 5x. The game finds a figure by distance, not by raycast.
	f.traverse((n) => { n.collides = false; });
	scene.add(f);
	f.play(clip, { time: Math.random() * 2, speed });
	return f;
}

for (let i = 0; i < ARCHERS; i++) {
	const f = figure('archer', (i - (ARCHERS - 1) / 2) * BRICK, WALL_Z, Math.PI, 'shoot', 0.8 + Math.random() * 0.4);
	f.position.y = TABLE + WALL_H * BRICK;
}
for (let i = 0; i < SWORDSMEN; i++) {
	const row = i % 2;
	figure('swordsman', (Math.floor(i / 2) - 5.5) * 0.11, WALL_Z + 0.12 + row * 0.07, Math.PI,
		Math.random() < 0.3 ? 'attack' : 'idle');
}

const orcs = [];
const positions = new Float32Array(ORCS * 3);
const velocities = new Float32Array(ORCS * 3);
const motions = new Float32Array(ORCS * 3);
const clips = [];
const since = new Float32Array(ORCS);

function spawn(i) {
	positions[i * 3] = (Math.random() - 0.5) * 1.8;
	positions[i * 3 + 1] = TABLE + HEIGHT / 2;
	positions[i * 3 + 2] = -1.3 - Math.random() * 1.1;
}
for (let i = 0; i < ORCS; i++) {
	spawn(i);
	orcs.push(figure('orc', positions[i * 3], positions[i * 3 + 2], 0, 'walk'));
	clips.push('walk');
}
const batch = three.batch(orcs, { euler: true });
const stride = batch.stride;
const heading = new Float32Array(ORCS);

// Milliseconds a frame in each part of the crowd's own work, and clip changes a frame.
const parts = { steer: 0, move: 0, loop: 0, flush: 0, rubble: 0, plays: 0 };

function moveOrcs(dt, now) {
	let t = performance.now();
	three.steer(positions, velocities, { goal: GOAL, maxSpeed: SPEED, arrive: 0, separation: 0.03 });
	parts.steer += performance.now() - t;
	for (let i = 0; i < ORCS; i++) {
		motions[i * 3] = velocities[i * 3] * dt;
		motions[i * 3 + 1] = -0.5 * dt;
		motions[i * 3 + 2] = velocities[i * 3 + 2] * dt;
	}
	const before = positions.slice();
	t = performance.now();
	three.moveAndSlideAll(positions, motions, { ...MOVE, self: batch.handles });
	parts.move += performance.now() - t;
	t = performance.now();
	const data = batch.positions;
	for (let i = 0; i < ORCS; i++) {
		if (positions[i * 3 + 2] > GOAL[2] - 0.08 || positions[i * 3 + 1] < TABLE - 0.2) spawn(i);
		const dx = positions[i * 3] - before[i * 3];
		const dz = positions[i * 3 + 2] - before[i * 3 + 2];
		const moved = Math.hypot(dx, dz) / dt;
		if (moved > 0.005) heading[i] = three.moveTowardsAngle(heading[i], Math.atan2(dx, dz), 6 * dt);
		// Pressed against the wall, an orc hacks at it; otherwise it walks.
		const want = moved < SPEED * 0.3 ? 'attack' : 'walk';
		if (want !== clips[i] && now - since[i] > 0.4) {
			orcs[i].play(want, { fade: 0.2, speed: want === 'walk' ? moved / WALK_SPEED : 1 });
			parts.plays++;
			clips[i] = want;
			since[i] = now;
		}
		const o = i * stride;
		data[o] = positions[i * 3];
		data[o + 1] = positions[i * 3 + 1] - HEIGHT / 2;
		data[o + 2] = positions[i * 3 + 2];
		data[o + 4] = heading[i];
	}
	parts.loop += performance.now() - t;
	t = performance.now();
	batch.flush();
	parts.flush += performance.now() - t;
}

// Rubble no longer stops anybody: a brick off its home leaves the sweeps.
function looseRubble() {
	const t = performance.now();
	for (const b of bricks) {
		if (b.blocks === false) continue;
		const p = b.position;
		if (Math.hypot(p.x - b.home[0], p.y - b.home[1], p.z - b.home[2]) > 0.03) b.blocks = false;
	}
	parts.rubble += performance.now() - t;
}

// Averages over a report: three.frame.ms, plus the GPU and draws every half second.
let m = fresh();
function fresh() {
	return { frames: 0, solver: 0, solverMax: 0, host: 0, script: 0, gpu: 0, gpuSamples: 0, stats: null, since: null };
}
function sample(now) {
	const ms = three.frame.ms;
	m.frames++;
	m.solver += ms.solver;
	m.solverMax = Math.max(m.solverMax, ms.solver);
	m.host += ms.host;
	m.script += ms.total;
	if (m.frames % 45 === 0) {
		const s = three.stats();
		m.gpu += s.gpuMs || 0;
		m.gpuSamples++;
		m.stats = s;
	}
	if (m.since === null) m.since = now;
	if (now - m.since >= 5) {
		const n = m.frames;
		const f = (v) => (v / n).toFixed(2);
		const s = m.stats || {};
		console.log(`crowd: ${ORCS + ARCHERS + SWORDSMEN} figures, ${(n / (now - m.since)).toFixed(0)} fps, ` +
			`solver ${f(m.solver)} (max ${m.solverMax.toFixed(2)}), host ${f(m.host)}, script ${f(m.script)}, ` +
			`gpu ${(m.gpu / Math.max(m.gpuSamples, 1)).toFixed(2)}, draws ${s.drawCalls}, ` +
			`skinned ${s.skinnedDraws}/${s.skinnedInstances}, loose ${bricks.filter((b) => b.blocks === false).length}`);
		console.log('crowd:   ' + Object.entries(parts).map(([k, v]) => `${k} ${(v / n).toFixed(3)}`).join(', '));
		for (const k in parts) parts[k] = 0;
		globalThis.crowd.last = { ...m, stats: s };
		m = fresh();
	}
}

globalThis.crowd = { orcs, bricks, stones, positions, velocities, last: null };

let started = false;
let nextStone = 3;
let nextWall = REBUILD_EVERY;
let last = null;
three.setAnimationLoop((ms) => {
	const now = ms / 1000;
	if (three.xr.presenting && three.xr.refreshRate !== HZ) three.xr.refreshRate = HZ;
	three.physics.rate = three.xr.refreshRate || 60;
	three.physics.substeps = 2;
	if (!started) {
		started = true;
		three.camera.lookAt(0, TABLE, -1.1);
		three.camera.orbit(0, 32, 1.9);
	}
	const dt = last === null ? 0 : Math.min(now - last, 0.05);
	last = now;
	if (dt === 0) return;
	moveOrcs(dt, now);
	if (now >= nextStone) {
		throwStone(now);
		nextStone = now + STONE_EVERY;
	}
	if (now >= nextWall) {
		rebuiltIn = buildWall();
		console.log(`crowd: wall rebuilt in ${rebuiltIn.toFixed(2)} ms (${bricks.length} bricks)`);
		nextWall = now + REBUILD_EVERY;
	}
	looseRubble();
	sample(now);
});
