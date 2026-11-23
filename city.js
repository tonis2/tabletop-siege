// city.js — the city on its hill, the plain and the orc camp.
//
//   ./build/three --assets ../tabletop-siege --no-boot --script ../tabletop-siege/city.js
//   packaging/android/quest.sh push ../tabletop-siege/city.js
//
// (The figures go to the headset once: adb push ../tabletop-siege/figures/.
// /sdcard/Android/data/dev.threec3.quest/files/game/figures/)
//
// Three half rings of wall climb a hill towards you, each with a gate, and the
// citadel's keep stands at the top with its back to you. Every piece of wall is
// a static body until a stone hits near it, so standing walls cost the solver
// nothing.
//
//   f, A      a catapult stone at the outer ring
//   r, B, Y   build the city again
//   v         at a desk, between the view from above and the view from where you stand
//   b         measure: three stones, until what they knocked loose is at rest

const HZ = 90;
const TABLE = 0.75;
// The figures are built 1.8 m tall and stand 6 cm here.
const SCALE = 1 / 30;
// The middle of the rings, on the cliff edge at the near side of the table.
// You stand behind it, at the origin.
const CITY_Z = -0.35;
// Each ring is a half circle, its ends on the cliff edge.
const SPAN = Math.PI;
// A course is `height` tall and `depth` thick. Bricks are cut to fit each ring
// near `length`, but no brick covers more than `most` radians: bricks meet at
// the wall's inner face and open a notch at its outer one, as deep as the angle.
const BRICK = { length: 0.12, height: 0.06, depth: 0.07, most: 0.2, gap: 0.001 };
const MERLON = 0.04;
const GATE = { width: 0.12, courses: 2, leaf: 0.02 };
// How far each terrace reaches past the foot of its wall, and the road up to
// each gate: its width and the length of its slope.
const LEDGE = 0.02;
const ROAD = 0.07;
const RAMP = 0.18;
// `gate` is the angle of the gate from straight ahead, + to the right. They
// alternate, so the road zig-zags up.
const RINGS = [
	{ name: 'outer', radius: 0.75, ground: 0, courses: 4, gate: -0.5 },
	{ name: 'middle', radius: 0.5, ground: 0.08, courses: 3, gate: 0.7 },
	{ name: 'inner', radius: 0.28, ground: 0.16, courses: 3, gate: -0.6 },
];
const PLAIN = { width: 2.6, depth: 3 };
// Kilograms per cubic metre: a brick is about a kilogram, heavier than a stone.
const DENSITY = { stone: 2000, wood: 600 };
// A stone frees the pieces whose nearest face is within `reach` metres of the
// point it is about to hit, `perSpeed` more for each m/s over `speed`, up to
// `most`, and pushes them with `share` of its momentum.
const impact = { speed: 2, reach: 0.015, perSpeed: 0.01, most: 0.08, share: 0.8 };
// A loose piece under `speed` m/s and `spin` rad/s for `quiet` seconds is at rest.
const REST = { speed: 0.05, spin: 0.3, quiet: 0.4 };
// A catapult stone: heavier than one brick, lighter than the few it knocks out.
// A flatter shot pushes bricks out of the wall; a steep one drives them into
// the course below and moves nothing.
const STONE = { radius: 0.03, mass: 1.5, flight: 0.55 };

const scene = new three.Scene();
scene.background = 0x8aa4c0;
three.light.set([-0.5, -1, -0.4], 0.9);

const { clamp01, smoothstep, fbm2, hash } = three;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const byte = (n) => (n < 0 ? 0 : n > 255 ? 255 : n);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const triple = (v) => [v.x, v.y, v.z];

// ---------------------------------------------------------------------------
// Textures, generated here so the game runs on a clean checkout.
// ---------------------------------------------------------------------------

const SIZE = 128;

// A colour map and a normal map from one pass: `shade(u, v, x, y)` answers
// [colour, height], and the normal is the height's slope.
function paint(shade, { relief = 3, wrap = false } = {}) {
	const color = new Uint8Array(SIZE * SIZE * 4);
	const height = new Float32Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const [c, h] = shade((x + 0.5) / SIZE, (y + 0.5) / SIZE, x, y);
			const i = y * SIZE + x;
			height[i] = h;
			color[i * 4] = byte(c[0]);
			color[i * 4 + 1] = byte(c[1]);
			color[i * 4 + 2] = byte(c[2]);
			color[i * 4 + 3] = 255;
		}
	}
	const at = wrap
		? (x, y) => height[((y + SIZE) % SIZE) * SIZE + (x + SIZE) % SIZE]
		: (x, y) => height[Math.min(Math.max(y, 0), SIZE - 1) * SIZE + Math.min(Math.max(x, 0), SIZE - 1)];
	const normal = new Uint8Array(SIZE * SIZE * 4);
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * relief;
			const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * relief;
			const k = 1 / Math.hypot(dx, dy, 1);
			const i = (y * SIZE + x) * 4;
			normal[i] = (-dx * k * 0.5 + 0.5) * 255;
			normal[i + 1] = (-dy * k * 0.5 + 0.5) * 255;
			normal[i + 2] = (k * 0.5 + 0.5) * 255;
			normal[i + 3] = 255;
		}
	}
	return new three.MeshLambertMaterial({
		map: new three.DataTexture(color, SIZE, SIZE),
		normalMap: new three.DataTexture(normal, SIZE, SIZE, { colorSpace: three.LinearSRGBColorSpace }),
	});
}

// One dressed stone per face: a rough face chiselled down at its edges.
const stoneMaterial = paint((u, v, x, y) => {
	const chisel = smoothstep(Math.min(u, 1 - u, v, 1 - v), 0, 0.12);
	const rough = fbm2(u * 6, v * 6, { octaves: 4, seed: 11 });
	const grit = hash(x, y, 13);
	const tone = (0.8 + 0.3 * rough) * (0.72 + 0.28 * chisel) + (grit - 0.5) * 0.08;
	return [scale3([182, 176, 164], tone), 0.55 * chisel + 0.35 * rough * chisel + 0.1 * grit];
});
stoneMaterial.uvVariants = [0, 1, 2, 3].flatMap((turn) => [[0, 0, turn, 0], [0, 0, turn, 3]]);

// A plank with its grain along v.
const woodMaterial = paint((u, v, x, y) => {
	const warp = fbm2(u * 3, v * 1.5, { octaves: 3, seed: 21 });
	const ring = 0.5 + 0.5 * Math.sin((u * 7 + warp * 2.5) * Math.PI * 2);
	const fibre = fbm2(u * 48, v * 3, { octaves: 2, seed: 22 });
	const ease = smoothstep(Math.min(u, 1 - u, v, 1 - v), 0, 0.07);
	const t = clamp01(0.5 * ring + 0.5 * fibre);
	return [scale3(mix([104, 68, 40], [178, 130, 84], t), 0.72 + 0.28 * ease), 0.6 * ease + 0.25 * fibre * ease + 0.15 * ring];
});

// Courses of big stones in mortar, tiling: the terraces' faces and paving.
function masonry(repeat) {
	const material = paint((u, v, x, y) => {
		const row = Math.floor(v * 4);
		const across = u * 4 + (row % 2) * 0.5;
		const col = Math.floor(across);
		const su = across - col;
		const sv = v * 4 - row;
		const face = smoothstep(Math.min(su, 1 - su, sv, 1 - sv), 0.03, 0.12);
		const rough = fbm2(u * 8, v * 8, { octaves: 4, period: 8, seed: 31 });
		const tone = 0.8 + 0.25 * hash(col % 4, row, 32);
		const stone = scale3([164, 156, 140], tone * (0.82 + 0.3 * rough));
		return [mix([100, 96, 88], stone, face), 0.15 + 0.6 * face + 0.25 * rough * face];
	}, { wrap: true });
	material.repeat = repeat;
	return material;
}

// Grass, tiling.
function turf(repeat, seed = 41) {
	const material = paint((u, v, x, y) => {
		const patch = fbm2(u * 6, v * 6, { octaves: 4, period: 6, seed });
		const blade = hash(x, y, seed + 1);
		let c = mix([70, 82, 40], [128, 136, 70], patch);
		if (blade > 0.9) c = scale3(c, 1.15);
		else if (blade < 0.08) c = scale3(c, 0.8);
		return [c, 0.7 * patch + 0.3 * blade];
	}, { relief: 2, wrap: true });
	material.repeat = repeat;
	material.stochastic = true;
	return material;
}

const pebbleMaterial = paint((u, v, x, y) => {
	const rough = fbm2(u * 8, v * 4, { octaves: 4, period: 8, seed: 51 });
	return [scale3([92, 90, 88], 0.75 + 0.45 * rough), rough];
}, { wrap: true });

const matte = new three.MeshLambertMaterial({});
const paving = masonry([10, 10]);

function box(size, at, material, color, body, rotation = [0, 0, 0]) {
	const mesh = new three.Mesh(new three.BoxGeometry(...size), material);
	mesh.position.set(...at);
	mesh.rotation.set(...rotation);
	if (color) mesh.color = color;
	scene.add(mesh);
	if (body) three.physics.add(mesh, { shape: 'box', mass: 0, friction: 0.8, ...body });
	return mesh;
}

// A point on a ring: `a` radians from straight ahead, `r` from the middle.
const onRing = (a, r, y) => [Math.sin(a) * r, TABLE + y, CITY_Z - Math.cos(a) * r];

// ---------------------------------------------------------------------------
// The ground: the floor, the table that is the plain, and the hill. The hill is
// a half disc per ring, paved, each one a terrace higher than the last.
// ---------------------------------------------------------------------------

const floor = box([20, 0.1, 20], [0, -0.05, 0], matte, [0.32, 0.3, 0.3], {});
const table = box([PLAIN.width, 0.1, PLAIN.depth], [0, TABLE - 0.05, CITY_Z - PLAIN.depth / 2],
	turf([PLAIN.width * 5, PLAIN.depth * 5]), null, {});

function halfDisc(radius, height, segments = 48) {
	const points = [];
	for (let i = 0; i <= segments; i++) {
		const a = -SPAN / 2 + SPAN * i / segments;
		points.push([Math.sin(a) * radius, 0, -Math.cos(a) * radius], [Math.sin(a) * radius, height, -Math.cos(a) * radius]);
	}
	return new three.ConvexGeometry(points);
}

// Where a terrace ends: a ledge past the outer face of its wall.
const terraceRadius = (ring) => ring.radius + BRICK.depth / 2 + LEDGE;
const roadRadius = (ring) => terraceRadius(ring) + ROAD / 2;

const terraces = RINGS.slice(1).map((ring) => {
	const mesh = new three.Mesh(halfDisc(terraceRadius(ring), ring.ground), paving);
	mesh.position.set(0, TABLE, CITY_Z);
	mesh.color = [0.95, 0.92, 0.86];
	scene.add(mesh);
	three.physics.add(mesh, { shape: 'hull', mass: 0, friction: 0.8 });
	return mesh;
});

// The road up to a gate on a raised ring: a landing in front of the gate, and a
// ramp down from it along the foot of the terrace, towards the gate below.
function road(k) {
	const ring = RINGS[k];
	const below = RINGS[k - 1];
	const rise = ring.ground - below.ground;
	const r = roadRadius(ring);
	const half = GATE.width / 2 + 0.02;
	const landing = box([half * 2, rise, ROAD], onRing(ring.gate, r, below.ground + rise / 2), paving, [0.9, 0.88, 0.82], {}, [0, -ring.gate, 0]);
	// Down towards the gate below.
	const side = below.gate < ring.gate ? -1 : 1;
	const centre = ring.gate + side * (half + RAMP / 2) / r;
	const pitch = Math.atan2(rise, RAMP);
	const thick = 0.03;
	const length = Math.hypot(RAMP, rise) + 0.01;
	// The top surface runs from the plain below to the landing; the box hangs
	// under it, square to the slope.
	const [x, y, z] = onRing(centre, r, below.ground + rise / 2);
	const down = [Math.sin(-side * pitch) * thick / 2, -Math.cos(pitch) * thick / 2];
	const tx = Math.cos(centre), tz = Math.sin(centre);
	const ramp = box([length, thick, ROAD], [x + tx * down[0], y + down[1], z + tz * down[0]], paving, [0.9, 0.88, 0.82], {},
		[0, -centre, -side * pitch]);
	return [landing, ramp];
}
const roads = RINGS.flatMap((ring, k) => (k === 0 ? [] : road(k)));

// ---------------------------------------------------------------------------
// The walls. A ring's pieces are boxes on its arc: a piece covers angles a0 to
// a1 at radius r, its bottom y above the table, h tall and d thick. Every other
// course starts half a brick round, so no joint sits over the one below.
// ---------------------------------------------------------------------------

function piece(kind, course, a0, a1, r, y, h, d) {
	return { kind, course, a0, a1, r, y, h, d, mesh: null, home: null };
}

// The angle one brick covers on a ring.
const stepOf = (ring) => SPAN / Math.round(SPAN / Math.min(BRICK.length / ring.radius, BRICK.most));

function lay(ring) {
	const pieces = [];
	const { radius: r, ground, courses, gate } = ring;
	const step = stepOf(ring);
	const half = GATE.width / 2 / r;
	for (let c = 0; c < courses; c++) {
		const y = ground + c * BRICK.height;
		let runs = [[-SPAN / 2, SPAN / 2]];
		if (c < GATE.courses) runs = [[-SPAN / 2, gate - half], [gate + half, SPAN / 2]];
		else if (c === GATE.courses) {
			// One stone over the gate, resting half a brick on each side.
			const l0 = gate - half - step / 2;
			const l1 = gate + half + step / 2;
			pieces.push(piece('lintel', c, l0, l1, r, y, BRICK.height, BRICK.depth));
			runs = [[-SPAN / 2, l0], [l1, SPAN / 2]];
		}
		const offset = (c % 2) * step / 2;
		for (const [s0, s1] of runs) {
			const cuts = [s0];
			for (let a = -SPAN / 2 + offset; a < s1 - 1e-6; a += step) if (a > s0 + 1e-6) cuts.push(a);
			cuts.push(s1);
			// A sliver at either end joins the brick beside it.
			if (cuts.length > 2 && cuts[1] - cuts[0] < step * 0.35) cuts.splice(1, 1);
			if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < step * 0.35) cuts.splice(cuts.length - 2, 1);
			for (let i = 0; i + 1 < cuts.length; i++) pieces.push(piece('brick', c, cuts[i], cuts[i + 1], r, y, BRICK.height, BRICK.depth));
		}
	}
	// Merlons on the outer half of the top, the end ones flush with the cliff;
	// the inner half is the wall-walk.
	const top = ground + courses * BRICK.height;
	const width = step / 2;
	const n = Math.round(SPAN / step);
	for (let k = 0; k < n; k++) {
		const a = -SPAN / 2 + width / 2 + k * (SPAN - width) / (n - 1);
		pieces.push(piece('merlon', courses, a - width / 2, a + width / 2, r + BRICK.depth / 4, top, MERLON, BRICK.depth / 2));
	}
	// The gate's two leaves, closed.
	const leafH = GATE.courses * BRICK.height - 0.004;
	pieces.push(piece('leaf', 0, gate - half, gate, r, ground, leafH, GATE.leaf));
	pieces.push(piece('leaf', 0, gate, gate + half, r, ground, leafH, GATE.leaf));
	return pieces;
}

const geometries = new Map();
function geometryFor(size) {
	const key = size.map((n) => n.toFixed(4)).join();
	if (!geometries.has(key)) geometries.set(key, new three.BoxGeometry(...size));
	return geometries.get(key);
}

const materialOf = (p) => (p.kind === 'leaf' ? 'wood' : 'stone');

function place(p, n) {
	const am = (p.a0 + p.a1) / 2;
	// Cut so its corners meet the next piece's at the inner face.
	const length = 2 * (p.r - p.d / 2) * Math.tan((p.a1 - p.a0) / 2) - BRICK.gap;
	p.size = [length, p.h, p.d];
	const wood = materialOf(p) === 'wood';
	const mesh = new three.Mesh(geometryFor(p.size), wood ? woodMaterial : stoneMaterial);
	p.home = onRing(am, p.r, p.y + p.h / 2);
	p.angle = am;
	mesh.position.set(...p.home);
	mesh.rotation.y = -am;
	const tone = 0.86 + 0.22 * hash(n, 7, 3);
	mesh.color = wood ? [0.7 * tone, 0.55 * tone, 0.42 * tone] : [tone, tone * 0.97, tone * 0.93];
	if (!wood) mesh.variant = Math.floor(hash(n, 5, 1) * 8);
	scene.add(mesh);
	p.mesh = mesh;
	p.mass = DENSITY[materialOf(p)] * length * p.h * p.d;
	return mesh;
}

// What each piece rests on: the pieces of the course below whose arcs overlap
// its own, or the ground.
function supports(pieces) {
	for (const p of pieces) {
		p.ground = p.course === 0;
		p.below = p.ground ? [] : pieces.filter((q) => q.course === p.course - 1 && q.kind !== 'leaf'
			&& Math.min(p.a1, q.a1) - Math.max(p.a0, q.a0) > 1e-3);
	}
}

// Every piece is a static body until a stone comes near it: a standing wall
// costs the solver nothing, and a hit moves only the pieces round it. A piece is
// `wall` (static, at home), `loose` (dynamic), `rubble` (static again where it
// came to rest) or `gone` (off the table).
const fixed = { shape: 'box', mass: 0, friction: 0.6 };
const dynamic = (p) => ({ shape: 'box', mass: p.mass, friction: 0.6, restitution: 0.05, angularDamping: 1 });

let rings = [];
const pieceOf = new Map();
const loose = new Set();

function buildCity() {
	const t = performance.now();
	for (const ring of rings) {
		for (const p of ring.pieces) {
			three.physics.remove(p.mesh);
			scene.remove(p.mesh);
		}
	}
	pieceOf.clear();
	loose.clear();
	let n = 0;
	rings = RINGS.map((ring, k) => {
		const pieces = lay(ring);
		for (const p of pieces) {
			place(p, n++);
			p.ring = k;
			p.state = 'wall';
			three.physics.add(p.mesh, fixed);
			pieceOf.set(p.mesh, p);
		}
		supports(pieces);
		return { ...ring, pieces };
	});
	return performance.now() - t;
}

function loosen(p) {
	three.physics.remove(p.mesh);
	three.physics.add(p.mesh, dynamic(p));
	p.state = 'loose';
	p.quiet = 0;
	loose.add(p);
}

// A piece left with nothing standing under it comes loose too. Pieces are laid
// course by course upwards, so one pass carries it to the top: a breach
// crumbles into a notch instead of leaving bricks hanging. Each piece rests on
// two below, so it takes both to go.
function dropUnsupported(ring) {
	for (const p of ring.pieces) {
		if (p.state === 'wall' && !p.ground && !p.below.some((q) => q.state === 'wall')) loosen(p);
	}
}

// A loose piece that has come to rest is rubble, static again where it lies; one
// that fell off the table goes.
function settle(dt) {
	for (const p of loose) {
		if (p.mesh.position.y < -1) {
			three.physics.remove(p.mesh);
			p.mesh.visible = false;
			p.state = 'gone';
			loose.delete(p);
			continue;
		}
		const v = three.physics.velocity(p.mesh);
		const resting = v === null || (Math.hypot(v[0], v[1], v[2]) < REST.speed && Math.hypot(v[3], v[4], v[5]) < REST.spin);
		p.quiet = resting ? p.quiet + dt : 0;
		if (p.quiet < REST.quiet) continue;
		three.physics.remove(p.mesh);
		three.physics.add(p.mesh, fixed);
		p.state = 'rubble';
		loose.delete(p);
	}
}

// ---------------------------------------------------------------------------
// The citadel: the keep at the back of the top terrace, its door facing the
// plain, and a banner.
// ---------------------------------------------------------------------------

const TOP = RINGS[RINGS.length - 1].ground;
const KEEP = [0.14, 0.2, 0.1];
const keepAt = [0, TABLE + TOP + KEEP[1] / 2, CITY_Z - KEEP[2] / 2 - 0.01];
const keepStone = masonry([1, 1.5]);
const keep = box(KEEP, keepAt, keepStone, [0.92, 0.9, 0.86], {});
const door = box([0.035, 0.055, 0.006], [0, TABLE + TOP + 0.0275, keepAt[2] - KEEP[2] / 2 - 0.002], woodMaterial, [0.45, 0.32, 0.22], null);
door.collides = false;
for (const x of [-1, 1]) {
	box([0.05, 0.26, 0.05], [x * (KEEP[0] / 2 + 0.01), TABLE + TOP + 0.13, keepAt[2] - 0.02], keepStone, [0.88, 0.86, 0.82], {});
}
const pole = box([0.004, 0.12, 0.004], [0, TABLE + TOP + KEEP[1] + 0.06, keepAt[2]], matte, [0.3, 0.25, 0.2], null);
pole.collides = false;
const banner = box([0.06, 0.035, 0.002], [0.031, TABLE + TOP + KEEP[1] + 0.1, keepAt[2]], matte, [0.85, 0.85, 0.9], null);
banner.collides = false;

// ---------------------------------------------------------------------------
// The figures, standing for scale: archers on the walls, swordsmen inside the
// outer gate, a company of orcs out of bowshot and the crews at the catapults.
// ---------------------------------------------------------------------------

const kinds = {
	orc: three.load('figures/orc.glb'),
	archer: three.load('figures/archer.glb'),
	swordsman: three.load('figures/swordsman.glb'),
};

function figure(kind, at, heading, clip) {
	const f = kinds[kind].instantiate();
	f.scale.set(SCALE, SCALE, SCALE);
	f.position.set(...at);
	f.rotation.y = heading;
	// The game finds figures by distance; as colliders they made every sweep dearer.
	f.traverse((node) => { node.collides = false; });
	scene.add(f);
	f.play(clip, { time: Math.random() * 2, speed: 0.8 + Math.random() * 0.4 });
	return f;
}

// Facing out from the middle of the rings, at angle a.
const outward = (a) => Math.atan2(Math.sin(a), -Math.cos(a));
const figures = [];

function standOnWalls() {
	for (const f of figures) scene.remove(f);
	figures.length = 0;
	RINGS.forEach((ring, k) => {
		const count = [12, 6, 4][k];
		const walk = ring.radius - BRICK.depth / 4;
		const y = ring.ground + ring.courses * BRICK.height;
		for (let i = 0; i < count; i++) {
			const a = -1.35 + 2.7 * (i + 0.5) / count;
			if (Math.abs(a - ring.gate) < 0.08) continue;
			figures.push(figure('archer', onRing(a, walk, y), outward(a), i % 3 === 0 ? 'shoot' : 'idle'));
		}
	});
	// Inside the outer gate.
	const gate = RINGS[0].gate;
	for (let i = 0; i < 12; i++) {
		const a = gate + (i % 6 - 2.5) * 0.06;
		const r = RINGS[0].radius - 0.08 - Math.floor(i / 6) * 0.05;
		figures.push(figure('swordsman', onRing(a, r, 0), outward(gate), 'idle'));
	}
}

// The camp at the far edge of the plain.
const CAMP_Z = CITY_Z - PLAIN.depth + 0.35;
const tentShape = new three.ConeGeometry(0.09, 0.12, 4);
for (let i = 0; i < 7; i++) {
	const tent = new three.Mesh(tentShape, matte);
	tent.position.set(-0.9 + i * 0.3, TABLE + 0.06, CAMP_Z - 0.12 - (i % 2) * 0.1);
	tent.rotation.y = Math.PI / 4 + i * 0.3;
	tent.color = [0.42, 0.3, 0.22];
	scene.add(tent);
}
// Catapults, a frame with its arm cocked. They do not shoot yet: `fire()` stands in.
const catapults = [-0.6, 0, 0.6].map((x) => {
	const z = CAMP_Z + 0.25;
	const frame = box([0.08, 0.03, 0.12], [x, TABLE + 0.015, z], woodMaterial, [0.55, 0.4, 0.3], {});
	const post = box([0.012, 0.06, 0.012], [x, TABLE + 0.06, z - 0.02], woodMaterial, [0.5, 0.36, 0.26], null);
	const arm = box([0.01, 0.01, 0.13], [x, TABLE + 0.07, z + 0.02], woodMaterial, [0.6, 0.44, 0.3], null, [-0.5, 0, 0]);
	for (const part of [post, arm]) part.collides = false;
	return { at: [x, TABLE + 0.12, z - 0.03], frame };
});

function camp() {
	// A company of 24, six across and four deep, facing the city.
	for (let i = 0; i < 24; i++) {
		const at = [(i % 6 - 2.5) * 0.045 - 0.25, TABLE, CAMP_Z + 0.55 + Math.floor(i / 6) * 0.045];
		figures.push(figure('orc', at, 0, i % 4 === 0 ? 'cheer' : 'idle'));
	}
	for (const c of catapults) {
		for (const dx of [-0.05, 0.05, 0]) {
			figures.push(figure('orc', [c.at[0] + dx, TABLE, c.at[2] + (dx === 0 ? -0.07 : 0.02)], 0, 'idle'));
		}
	}
}

// ---------------------------------------------------------------------------
// Test stones from the camp, and what they break: a stone that will reach a
// piece within two steps frees the pieces round that point and pushes them.
// ---------------------------------------------------------------------------

const stoneShape = new three.SphereGeometry(STONE.radius, 12, 8);
const stoneBody = () => ({ shape: 'sphere', mass: STONE.mass, friction: 0.6, restitution: 0.1, angularDamping: 2 });
const stones = [];
const striking = new Set();
let fired = 0;

// A stone lobbed from the nearest catapult at a point, or at a random one on the
// outer ring's face.
function fire(target = null) {
	if (target === null) {
		const ring = RINGS[0];
		const a = (Math.random() * 2 - 1) * 1.2;
		target = onRing(a, ring.radius + BRICK.depth / 2, ring.ground + (0.3 + 0.6 * Math.random()) * ring.courses * BRICK.height);
	}
	const from = catapults.reduce((a, b) => (Math.abs(b.at[0] - target[0]) < Math.abs(a.at[0] - target[0]) ? b : a)).at;
	const stone = new three.Mesh(stoneShape, pebbleMaterial);
	stone.position.set(...from);
	scene.add(stone);
	three.physics.add(stone, stoneBody());
	three.physics.setVelocity(stone, lob(from, target, STONE.flight));
	stones.push(stone);
	striking.add(stone);
	if (stones.length > 8) {
		const old = stones.shift();
		striking.delete(old);
		three.physics.remove(old);
		scene.remove(old);
	}
	fired++;
	return stone;
}

// The world's own drag keeps 90% of a body's velocity a second, enough to land a
// lob several centimetres short; this one is aimed with it.
const DRAG = -Math.log(0.9);
function lob(from, to, T) {
	const g = 9.81;
	const reach = (1 - Math.exp(-DRAG * T)) / DRAG;
	const d = sub(to, from);
	return [d[0] / reach, (d[1] + g * T / DRAG) / reach - g / DRAG, d[2] / reach];
}

// How far a piece's nearest face is from a point, in its home frame.
function distanceTo(p, point) {
	const d = sub(point, triple(p.mesh.position));
	const t = d[0] * Math.cos(p.angle) + d[2] * Math.sin(p.angle);
	const n = d[0] * Math.sin(p.angle) - d[2] * Math.cos(p.angle);
	const e = [Math.abs(t) - p.size[0] / 2, Math.abs(d[1]) - p.size[1] / 2, Math.abs(n) - p.size[2] / 2];
	return Math.hypot(Math.max(e[0], 0), Math.max(e[1], 0), Math.max(e[2], 0));
}

let freed = 0;
function strike() {
	const ahead = 2 / (three.physics.rate || 60);
	for (const stone of striking) {
		const v = three.physics.velocity(stone);
		const speed = v === null ? 0 : Math.hypot(v[0], v[1], v[2]);
		const from = triple(stone.position);
		if (speed < impact.speed && from[1] < TABLE + 0.5) {
			striking.delete(stone);
			continue;
		}
		const to = [from[0] + v[0] * ahead, from[1] + v[1] * ahead, from[2] + v[2] * ahead];
		const hit = three.query.sweep(from, to, { radius: STONE.radius, ignore: stone });
		if (hit === null) continue;
		const struck = pieceOf.get(hit.object);
		if (struck === undefined || struck.state === 'loose') continue;
		striking.delete(stone);
		const radius = Math.min(impact.reach + impact.perSpeed * (speed - impact.speed), impact.most);
		const point = triple(hit.point);
		const near = new Map();
		for (const ring of rings) {
			for (const p of ring.pieces) {
				if (p.state !== 'wall' && p.state !== 'rubble') continue;
				const d = p === struck ? 0 : distanceTo(p, point);
				if (d <= radius) near.set(p, d);
			}
		}
		let total = 0;
		for (const [p, d] of near) {
			loosen(p);
			p.weight = p === struck ? 1 : 0.5 * (1 - d / Math.max(radius, 1e-3));
			total += p.weight;
		}
		for (const p of near.keys()) {
			const k = (p.weight / total) * STONE.mass * impact.share;
			three.physics.applyImpulse(p.mesh, [v[0] * k, v[1] * k, v[2] * k]);
		}
		const before = loose.size;
		dropUnsupported(rings[struck.ring]);
		freed += near.size + loose.size - before;
	}
}

// ---------------------------------------------------------------------------
// Where you stand, the keys, and what a frame costs.
// ---------------------------------------------------------------------------

// Puts your head at the origin facing the plain: the play area's centre is
// wherever the headset's guardian put it.
function stepUp() {
	const h = three.xr.head.position;
	const d = three.xr.head.direction;
	const t = three.camera.target;
	const yaw = three.camera.yaw * Math.PI / 180;
	const c = Math.cos(yaw), s = Math.sin(yaw);
	const turn = (x, z, cs, sn) => [x * cs + z * sn, -x * sn + z * cs];
	const [lx, lz] = turn(h.x - t.x, h.z - t.z, c, -s);
	const [fx, fz] = turn(d.x, d.z, c, -s);
	const facing = Math.atan2(-fx, -fz);
	const [wx, wz] = turn(lx, lz, Math.cos(-facing), Math.sin(-facing));
	three.camera.lookAt(-wx, 0, -wz);
	three.camera.orbit(-facing * 180 / Math.PI, 0, 0);
}

let view = 'above';
function deskView() {
	if (view === 'above') {
		three.camera.lookAt(0, TABLE, -1.2);
		three.camera.orbit(0, 38, 2.4);
	} else {
		// Standing at the origin, 1.65 m tall, looking down over the citadel.
		three.camera.lookAt(0, 1.65, 0);
		three.camera.orbit(0, 32, 0);
	}
}

function counts() {
	const c = { pieces: 0, wall: 0, loose: 0, rubble: 0, gone: 0 };
	for (const ring of rings) {
		for (const p of ring.pieces) {
			c.pieces++;
			c[p.state]++;
		}
	}
	return c;
}

function reset() {
	for (const s of stones) {
		three.physics.remove(s);
		scene.remove(s);
	}
	stones.length = 0;
	striking.clear();
	freed = 0;
	const ms = buildCity();
	standOnWalls();
	camp();
	console.log(`city: built, ${counts().pieces} pieces in ${rings.length} rings, all static, in ${ms.toFixed(2)} ms`);
}

let m = { frames: 0, solver: 0, solverMax: 0, script: 0, since: null };
// The solver's last 600 frames, for reading over MCP.
const history = [];
function sample(now) {
	const ms = three.frame.ms;
	history.push(+ms.solver.toFixed(3));
	if (history.length > 600) history.shift();
	m.frames++;
	m.solver += ms.solver;
	m.solverMax = Math.max(m.solverMax, ms.solver);
	m.script += ms.total;
	if (m.since === null) m.since = now;
	if (now - m.since < 5) return;
	const s = three.stats();
	const n = m.frames;
	const c = counts();
	console.log(`city: ${(n / (now - m.since)).toFixed(0)} fps, solver ${(m.solver / n).toFixed(2)} (max ${m.solverMax.toFixed(2)}), ` +
		`script ${(m.script / n).toFixed(2)}, gpu ${(s.gpuMs || 0).toFixed(2)}, draws ${s.drawCalls}, ` +
		`${c.loose} loose, ${c.rubble} rubble, ${c.gone} gone`);
	globalThis.city.last = { fps: n / (now - m.since), solver: m.solver / n, solverMax: m.solverMax, script: m.script / n, gpu: s.gpuMs, draws: s.drawCalls };
	m = { frames: 0, solver: 0, solverMax: 0, script: 0, since: now };
}

// A repeatable measure for the desk and the headset: build the city, fire three
// stones at fixed points on the outer ring, and wait until every piece they
// freed is rubble again. Logs the solver's ms a step while they were loose.
let bench = null;
function startBench() {
	reset();
	const r = RINGS[0].radius + BRICK.depth / 2;
	for (const [a, y] of [[0, 0.12], [0.5, 0.15], [-0.9, 0.1]]) fire(onRing(a, r, y));
	bench = { since: three.clock.time, steps: [], first: null };
}

function tickBench() {
	if (bench === null) return;
	const solver = three.frame.ms.solver;
	if (solver > 0.02) bench.steps.push(solver);
	if (bench.first === null && loose.size > 0) bench.first = three.clock.time;
	const elapsed = three.clock.time - bench.since;
	if (!(bench.first !== null && loose.size === 0 && elapsed > 2) && elapsed < 30) return;
	const st = bench.steps;
	const c = counts();
	const result = {
		loose: +(bench.first === null ? 0 : three.clock.time - bench.first).toFixed(2),
		freed,
		rubble: c.rubble,
		gone: c.gone,
		mean: +(st.reduce((a, b) => a + b, 0) / Math.max(st.length, 1)).toFixed(2),
		max: +Math.max(0, ...st).toFixed(2),
	};
	console.log(`city: bench, three stones freed ${freed} pieces, all at rest in ${result.loose} s; ` +
		`solver ${result.mean} ms a step, max ${result.max}; ${c.rubble} rubble, ${c.gone} off the table`);
	globalThis.city.bench = result;
	bench = null;
}

// For tuning over MCP: change RINGS, DENSITY or impact and call reset().
globalThis.city = {
	RINGS, BRICK, GATE, DENSITY, impact, REST, STONE, reset, fire, counts, startBench, bench: null, history, stones, scene,
	get rings() { return rings; },
	get loose() { return loose; },
	get freed() { return freed; },
	get fired() { return fired; },
	last: null,
};

let ready = false;
let waitingSince = null;
let last = null;

three.setAnimationLoop((ms) => {
	const now = ms / 1000;
	if (three.xr.presenting && three.xr.refreshRate !== HZ) three.xr.refreshRate = HZ;
	// The desk steps at the headset's rate, so what settles here settles there.
	three.physics.rate = three.xr.refreshRate || HZ;
	three.physics.substeps = 2;
	const dt = last === null ? 0 : Math.min(now - last, 0.1);
	last = now;

	if (!ready) {
		if (three.xr.presenting) {
			waitingSince ??= now;
			if (!three.xr.head.tracked && now - waitingSince < 2) return;
			stepUp();
		} else deskView();
		ready = true;
		reset();
		return;
	}

	const { left, right } = three.xr;
	if (three.input.pressed('r') || right.pressed('b') || left.pressed('y')) reset();
	if (three.input.pressed('f') || right.pressed('a')) fire();
	if (three.input.pressed('v') && !three.xr.presenting) {
		view = view === 'above' ? 'standing' : 'above';
		deskView();
	}
	if (three.input.pressed('b')) startBench();
	strike();
	settle(dt);
	tickBench();
	sample(now);
});
