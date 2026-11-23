# Builds the figures in Blender and exports one .glb per figure.
#   blender -b -P figures/build.py
# Or from a running Blender: exec(open(path).read(), {'__file__': path})
#
# Figures are boxes, each bound wholly to one bone, coloured by vertex colour so a figure is one
# primitive and one draw call however many copies stand on the table. All three share a skeleton,
# so every clip fits every figure. Built at human size (1.8 m) and scaled down in the game.

import bpy, bmesh, math, os
from mathutils import Matrix, Euler

OUT = os.path.dirname(os.path.abspath(__file__))
FPS = 30

# name, head, tail, parent. Blender axes: Z up, the figure faces -Y, its left is +X.
BONES = [
	('root', (0, 0, 0), (0, 0, 0.3), None),
	('hips', (0, 0, 0.95), (0, 0, 1.08), 'root'),
	('spine', (0, 0, 1.08), (0, 0, 1.32), 'hips'),
	('chest', (0, 0, 1.32), (0, 0, 1.55), 'spine'),
	('head', (0, 0, 1.58), (0, 0, 1.85), 'chest'),
]
for side, x in (('L', 0.25), ('R', -0.25)):
	BONES += [
		(f'upper_arm.{side}', (x, 0, 1.52), (x, 0, 1.22), 'chest'),
		(f'forearm.{side}', (x, 0, 1.22), (x, 0, 0.98), f'upper_arm.{side}'),
		(f'hand.{side}', (x, 0, 0.98), (x, 0, 0.88), f'forearm.{side}'),
	]
for side, x in (('L', 0.1), ('R', -0.1)):
	BONES += [
		(f'thigh.{side}', (x, 0, 0.95), (x, 0, 0.52), 'hips'),
		(f'shin.{side}', (x, 0, 0.52), (x, 0, 0.1), f'thigh.{side}'),
		(f'foot.{side}', (x, 0, 0.1), (x, -0.14, 0.02), f'shin.{side}'),
	]
NAMES = [b[0] for b in BONES]


def clear():
	for o in list(bpy.data.objects):
		bpy.data.objects.remove(o)
	for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.actions):
		for d in list(coll):
			coll.remove(d)
	scene = bpy.context.scene
	scene.render.fps = FPS


def override(ob):
	wm = bpy.context.window_manager
	if wm.windows:
		win = wm.windows[0]
		area = next(a for a in win.screen.areas if a.type == 'VIEW_3D')
		return bpy.context.temp_override(window=win, area=area, active_object=ob, object=ob)
	return bpy.context.temp_override(active_object=ob, object=ob)


def mode(ob, m):
	bpy.context.view_layer.objects.active = ob
	with override(ob):
		bpy.ops.object.mode_set(mode=m)


def build_rig():
	arm = bpy.data.armatures.new('rig')
	rig = bpy.data.objects.new('rig', arm)
	bpy.context.scene.collection.objects.link(rig)
	mode(rig, 'EDIT')
	for name, head, tail, parent in BONES:
		b = arm.edit_bones.new(name)
		b.head, b.tail, b.roll = head, tail, 0
		if parent:
			b.parent = arm.edit_bones[parent]
			b.use_connect = False
	mode(rig, 'OBJECT')
	for pb in rig.pose.bones:
		pb.rotation_mode = 'XYZ'
	return rig


def material():
	m = bpy.data.materials.new('figure')
	m.use_nodes = True
	nodes = m.node_tree.nodes
	bsdf = nodes['Principled BSDF']
	bsdf.inputs['Roughness'].default_value = 0.8
	attr = nodes.new('ShaderNodeVertexColor')
	attr.layer_name = 'Color'
	m.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
	return m


def figure(rig, name, parts):
	"""parts: (bone, centre, size, colour, rotation) at the rest pose, in rig space."""
	bm = bmesh.new()
	deform = bm.verts.layers.deform.verify()
	colour = bm.loops.layers.float_color.new('Color')
	for part in parts:
		bone, centre, size, rgb = part[:4]
		rot = part[4] if len(part) > 4 else (0, 0, 0)
		m = Matrix.Translation(centre) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
		made = bmesh.ops.create_cube(bm, size=1, matrix=m)['verts']
		group = NAMES.index(bone)
		for v in made:
			v[deform][group] = 1.0
		faces = {f for v in made for f in v.link_faces}
		for f in faces:
			for loop in f.loops:
				loop[colour] = (*srgb_to_linear(rgb), 1)
	mesh = bpy.data.meshes.new(name)
	bm.to_mesh(mesh)
	bm.free()
	mesh.color_attributes.active_color_name = 'Color'
	mesh.color_attributes.default_color_name = 'Color'
	mesh.materials.append(bpy.data.materials['figure'])
	ob = bpy.data.objects.new(name, mesh)
	bpy.context.scene.collection.objects.link(ob)
	for n in NAMES:
		ob.vertex_groups.new(name=n)
	ob.parent = rig
	ob.modifiers.new('rig', 'ARMATURE').object = rig
	return ob


def srgb_to_linear(rgb):
	return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)


def mirrored(parts):
	"""Each part named with .L also gets its .R twin, mirrored in X."""
	out = []
	for p in parts:
		out.append(p)
		if p[0].endswith('.L'):
			c = p[1]
			rot = p[4] if len(p) > 4 else (0, 0, 0)
			out.append((p[0][:-2] + '.R', (-c[0], c[1], c[2]), p[2], p[3], (rot[0], -rot[1], -rot[2])))
	return out


# Colours, sRGB.
SKIN = (0.86, 0.66, 0.52)
BLUE = (0.18, 0.3, 0.66)
WHITE = (0.92, 0.92, 0.88)
LEATHER = (0.42, 0.27, 0.14)
DARK = (0.12, 0.1, 0.09)
STEEL = (0.72, 0.74, 0.78)
MAIL = (0.5, 0.52, 0.56)
CLOTH = (0.32, 0.27, 0.22)

ORC_SKIN = (0.36, 0.47, 0.2)
ORC_HIDE = (0.25, 0.17, 0.1)
IRON = (0.33, 0.33, 0.36)
RUST = (0.5, 0.24, 0.1)
TUSK = (0.92, 0.89, 0.76)
RED = (0.95, 0.2, 0.05)


def orc_parts():
	return mirrored([
		('hips', (0, 0, 0.98), (0.46, 0.32, 0.2), ORC_HIDE),
		('hips', (0, -0.01, 0.84), (0.44, 0.3, 0.16), ORC_HIDE),
		('spine', (0, 0, 1.2), (0.5, 0.34, 0.26), ORC_SKIN),
		('chest', (0, 0.0, 1.43), (0.6, 0.38, 0.3), IRON),
		('chest', (0, -0.195, 1.4), (0.2, 0.01, 0.2), RUST),
		('chest', (0.32, 0, 1.58), (0.2, 0.26, 0.1), RUST),
		('chest', (-0.32, 0, 1.58), (0.2, 0.26, 0.1), RUST),
		('head', (0, -0.07, 1.7), (0.32, 0.32, 0.28), ORC_SKIN),
		('head', (0, -0.13, 1.58), (0.3, 0.18, 0.1), ORC_SKIN),
		('head', (0, -0.235, 1.78), (0.3, 0.05, 0.06), (0.26, 0.35, 0.14)),
		('head', (0.075, -0.235, 1.73), (0.06, 0.02, 0.04), RED),
		('head', (-0.075, -0.235, 1.73), (0.06, 0.02, 0.04), RED),
		('head', (0.09, -0.225, 1.64), (0.04, 0.04, 0.1), TUSK),
		('head', (-0.09, -0.225, 1.64), (0.04, 0.04, 0.1), TUSK),
		('upper_arm.L', (0.31, 0, 1.37), (0.16, 0.16, 0.32), ORC_SKIN),
		('forearm.L', (0.31, 0, 1.1), (0.15, 0.15, 0.28), ORC_SKIN),
		('forearm.L', (0.31, 0, 1.04), (0.17, 0.17, 0.12), ORC_HIDE),
		('hand.L', (0.31, 0, 0.92), (0.14, 0.14, 0.13), ORC_SKIN),
		('thigh.L', (0.13, 0, 0.73), (0.19, 0.21, 0.44), ORC_HIDE),
		('shin.L', (0.13, 0, 0.32), (0.17, 0.19, 0.42), ORC_SKIN),
		('foot.L', (0.13, -0.05, 0.05), (0.19, 0.32, 0.1), ORC_HIDE),
	]) + [
		# The cleaver, held pointing forward.
		('hand.R', (-0.31, -0.12, 0.92), (0.04, 0.26, 0.04), ORC_HIDE),
		('hand.R', (-0.31, -0.42, 0.97), (0.03, 0.38, 0.2), IRON),
	]


def defender_body(torso, sleeve, legs):
	return [
		('hips', (0, 0, 0.98), (0.38, 0.25, 0.2), torso),
		('spine', (0, 0, 1.2), (0.38, 0.23, 0.26), torso),
		('spine', (0, 0, 1.07), (0.4, 0.26, 0.05), LEATHER),
		('chest', (0, 0, 1.43), (0.44, 0.25, 0.25), torso),
		('head', (0, -0.02, 1.71), (0.23, 0.23, 0.25), SKIN),
		('head', (0.05, -0.135, 1.73), (0.04, 0.01, 0.03), DARK),
		('head', (-0.05, -0.135, 1.73), (0.04, 0.01, 0.03), DARK),
		('upper_arm.L', (0.27, 0, 1.38), (0.12, 0.13, 0.3), sleeve),
		('forearm.L', (0.27, 0, 1.1), (0.11, 0.11, 0.26), LEATHER),
		('hand.L', (0.27, 0, 0.92), (0.1, 0.1, 0.1), SKIN),
		('thigh.L', (0.1, 0, 0.73), (0.15, 0.17, 0.44), legs),
		('shin.L', (0.1, 0, 0.32), (0.14, 0.15, 0.42), LEATHER),
		('foot.L', (0.1, -0.04, 0.05), (0.15, 0.27, 0.1), LEATHER),
	]


def archer_parts():
	wood = (0.52, 0.34, 0.15)
	return mirrored(defender_body(BLUE, CLOTH, CLOTH) + [
		('chest', (0, -0.13, 1.33), (0.08, 0.01, 0.42), WHITE),
		('head', (0, 0.025, 1.76), (0.27, 0.27, 0.22), (0.3, 0.34, 0.24)),
		('chest', (0.09, 0.16, 1.45), (0.11, 0.11, 0.38), LEATHER, (0, 0.35, 0)),
		('chest', (0.15, 0.16, 1.66), (0.09, 0.09, 0.07), WHITE, (0, 0.35, 0)),
	]) + [
		# The bow lies forward from the left hand; with the arm raised it stands upright.
		('hand.L', (0.27, 0, 0.9), (0.035, 0.5, 0.035), wood),
		('hand.L', (0.27, -0.31, 0.86), (0.035, 0.17, 0.035), wood, (-0.45, 0, 0)),
		('hand.L', (0.27, 0.31, 0.86), (0.035, 0.17, 0.035), wood, (0.45, 0, 0)),
		('hand.L', (0.27, 0, 0.83), (0.01, 0.76, 0.01), WHITE),
	]


def swordsman_parts():
	return mirrored(defender_body(BLUE, MAIL, MAIL) + [
		('hips', (0, 0, 0.87), (0.37, 0.26, 0.18), BLUE),
		('chest', (0, -0.13, 1.38), (0.14, 0.01, 0.16), WHITE),
		('chest', (0.27, 0, 1.57), (0.17, 0.23, 0.08), STEEL),
		('chest', (-0.27, 0, 1.57), (0.17, 0.23, 0.08), STEEL),
		('head', (0, 0, 1.79), (0.27, 0.27, 0.17), STEEL),
		('head', (0, -0.135, 1.71), (0.03, 0.02, 0.1), STEEL),
	]) + [
		# The shield on the outside of the left forearm.
		('forearm.L', (0.36, 0, 1.08), (0.04, 0.48, 0.58), BLUE),
		('forearm.L', (0.383, 0, 1.08), (0.01, 0.07, 0.5), WHITE),
		('forearm.L', (0.383, 0, 1.12), (0.01, 0.38, 0.07), WHITE),
		('forearm.L', (0.39, 0, 1.08), (0.02, 0.1, 0.1), STEEL),
		# The sword, held pointing forward.
		('hand.R', (-0.27, -0.03, 0.9), (0.035, 0.12, 0.035), LEATHER),
		('hand.R', (-0.27, -0.1, 0.9), (0.16, 0.03, 0.04), STEEL),
		('hand.R', (-0.27, -0.42, 0.9), (0.015, 0.6, 0.05), STEEL),
	]


# Clips. Each is (frames, loop, keys): keys maps a bone to [(frame, (rx, ry, rz))], and
# 'root.loc' to [(frame, (x, y, z))] in the root bone's frame, where y is up.
# On a bone hanging down, -x swings it forward; on one pointing up, +x bends it forward.

def walk(speed=1.0, lean=0.05, thigh=0.45, knee=0.7, arm=0.35, bob=0.03):
	n = round(30 / speed)
	h, q, t = n // 2, n // 4, 3 * n // 4
	return {
		'thigh.L': [(0, (-thigh, 0, 0)), (h, (thigh, 0, 0)), (n, (-thigh, 0, 0))],
		'thigh.R': [(0, (thigh, 0, 0)), (h, (-thigh, 0, 0)), (n, (thigh, 0, 0))],
		'shin.L': [(0, (0.05, 0, 0)), (h, (0.15, 0, 0)), (t, (knee, 0, 0)), (n, (0.05, 0, 0))],
		'shin.R': [(0, (0.15, 0, 0)), (q, (knee, 0, 0)), (h, (0.05, 0, 0)), (n, (0.15, 0, 0))],
		'upper_arm.L': [(0, (arm, 0, 0)), (h, (-arm, 0, 0)), (n, (arm, 0, 0))],
		'upper_arm.R': [(0, (-arm, 0, 0)), (h, (arm, 0, 0)), (n, (-arm, 0, 0))],
		'forearm.L': [(0, (-0.3 - arm, 0, 0)), (n, (-0.3 - arm, 0, 0))],
		'forearm.R': [(0, (-0.3 - arm, 0, 0)), (n, (-0.3 - arm, 0, 0))],
		'spine': [(0, (lean, 0, 0)), (n, (lean, 0, 0))],
		'root.loc': [(0, (0, 0, 0)), (q, (0, bob, 0)), (h, (0, 0, 0)), (t, (0, bob, 0)), (n, (0, 0, 0))],
	}, n


def clips():
	out = {}
	k, n = walk()
	out['walk'] = (n, True, k)
	k, n = walk(speed=1.7, lean=0.3, thigh=0.8, knee=1.3, arm=0.7, bob=0.06)
	out['run'] = (n, True, k)
	k, n = walk(speed=0.8, lean=0.15, thigh=0.4, knee=0.6, arm=0, bob=0.02)
	k['upper_arm.L'] = [(0, (-1.1, 0, 0)), (n, (-1.1, 0, 0))]
	k['upper_arm.R'] = [(0, (-1.1, 0, 0)), (n, (-1.1, 0, 0))]
	k['forearm.L'] = [(0, (-0.5, 0, 0)), (n, (-0.5, 0, 0))]
	k['forearm.R'] = [(0, (-0.5, 0, 0)), (n, (-0.5, 0, 0))]
	out['carry'] = (n, True, k)
	out['idle'] = (60, True, {
		'chest': [(0, (0, 0, 0)), (30, (0.04, 0, 0)), (60, (0, 0, 0))],
		'head': [(0, (0, 0, 0)), (20, (0, 0, 0.25)), (40, (0, 0, -0.2)), (60, (0, 0, 0))],
		'upper_arm.L': [(0, (0, 0, -0.08)), (30, (0.05, 0, -0.1)), (60, (0, 0, -0.08))],
		'upper_arm.R': [(0, (-0.2, 0, 0.08)), (30, (-0.25, 0, 0.1)), (60, (-0.2, 0, 0.08))],
		'forearm.R': [(0, (-0.5, 0, 0)), (60, (-0.5, 0, 0))],
		'forearm.L': [(0, (-0.3, 0, 0)), (60, (-0.3, 0, 0))],
		'root.loc': [(0, (0, 0, 0)), (30, (0, -0.01, 0)), (60, (0, 0, 0))],
	})
	out['attack'] = (24, True, {
		'upper_arm.R': [(0, (-0.3, 0, 0)), (9, (-2.7, 0, 0)), (14, (-0.5, 0, 0)), (24, (-0.3, 0, 0))],
		'forearm.R': [(0, (-0.5, 0, 0)), (9, (-0.7, 0, 0)), (14, (-0.1, 0, 0)), (24, (-0.5, 0, 0))],
		'upper_arm.L': [(0, (-0.6, 0, -0.2)), (24, (-0.6, 0, -0.2))],
		'forearm.L': [(0, (-1.0, 0, 0)), (24, (-1.0, 0, 0))],
		'spine': [(0, (0.05, 0, 0)), (9, (-0.12, 0, 0.15)), (14, (0.3, 0, -0.1)), (24, (0.05, 0, 0))],
		'thigh.L': [(0, (-0.3, 0, 0)), (24, (-0.3, 0, 0))],
		'thigh.R': [(0, (0.3, 0, 0)), (24, (0.3, 0, 0))],
		'shin.L': [(0, (0.3, 0, 0)), (24, (0.3, 0, 0))],
	})
	out['shoot'] = (45, True, {
		'upper_arm.L': [(0, (-1.5, 0, 0)), (45, (-1.5, 0, 0))],
		'upper_arm.R': [(0, (-1.5, 0, 0)), (24, (-1.45, 0, 0)), (34, (-1.45, 0, 0)), (36, (-1.3, 0, 0)), (45, (-1.5, 0, 0))],
		'forearm.R': [(0, (0, 0, -0.3)), (8, (0, 0, -0.6)), (22, (0, 0, -2.6)), (33, (0, 0, -2.6)), (35, (0, 0, -2.1)), (45, (0, 0, -0.3))],
		'chest': [(0, (0, 0, -0.15)), (45, (0, 0, -0.15))],
		'head': [(0, (0, 0, 0.15)), (45, (0, 0, 0.15))],
		'thigh.L': [(0, (-0.25, 0, 0)), (45, (-0.25, 0, 0))],
		'thigh.R': [(0, (0.2, 0, 0)), (45, (0.2, 0, 0))],
	})
	out['die'] = (36, False, {
		'root': [(0, (0, 0, 0)), (6, (-0.15, 0, 0)), (22, (-1.57, 0, 0)), (27, (-1.4, 0, 0)), (32, (-1.57, 0, 0)), (36, (-1.57, 0, 0))],
		'upper_arm.L': [(0, (0, 0, 0)), (12, (-1.8, 0, -0.6)), (24, (-2.6, 0, -0.9)), (36, (-2.6, 0, -0.9))],
		'upper_arm.R': [(0, (0, 0, 0)), (12, (-1.8, 0, 0.6)), (24, (-2.6, 0, 0.9)), (36, (-2.6, 0, 0.9))],
		'thigh.L': [(0, (0, 0, 0)), (14, (-0.6, 0, 0)), (24, (-0.2, 0, -0.15)), (36, (-0.2, 0, -0.15))],
		'shin.L': [(0, (0, 0, 0)), (14, (0.9, 0, 0)), (24, (0.2, 0, 0)), (36, (0.2, 0, 0))],
		'thigh.R': [(0, (0, 0, 0)), (24, (0, 0, 0.15)), (36, (0, 0, 0.15))],
		'head': [(0, (0, 0, 0)), (20, (-0.4, 0, 0)), (26, (0.1, 0, 0.3)), (36, (0.1, 0, 0.3))],
	})
	out['dangle'] = (20, True, {
		'thigh.L': [(0, (-0.7, 0, 0)), (10, (0.3, 0, 0)), (20, (-0.7, 0, 0))],
		'thigh.R': [(0, (0.3, 0, 0)), (10, (-0.7, 0, 0)), (20, (0.3, 0, 0))],
		'shin.L': [(0, (0.2, 0, 0)), (10, (1.1, 0, 0)), (20, (0.2, 0, 0))],
		'shin.R': [(0, (1.1, 0, 0)), (10, (0.2, 0, 0)), (20, (1.1, 0, 0))],
		'upper_arm.L': [(0, (0, 0, -1.9)), (5, (0, 0, -2.4)), (10, (0, 0, -1.9)), (15, (0, 0, -2.4)), (20, (0, 0, -1.9))],
		'upper_arm.R': [(0, (0, 0, 2.4)), (5, (0, 0, 1.9)), (10, (0, 0, 2.4)), (15, (0, 0, 1.9)), (20, (0, 0, 2.4))],
		'head': [(0, (-0.2, 0, 0.2)), (10, (-0.2, 0, -0.2)), (20, (-0.2, 0, 0.2))],
	})
	out['cheer'] = (30, True, {
		'upper_arm.R': [(0, (-2.3, 0, 0)), (15, (-3.0, 0, 0)), (30, (-2.3, 0, 0))],
		'forearm.R': [(0, (-0.8, 0, 0)), (15, (0, 0, 0)), (30, (-0.8, 0, 0))],
		'upper_arm.L': [(0, (-0.3, 0, -0.5)), (15, (-0.3, 0, -0.7)), (30, (-0.3, 0, -0.5))],
		'spine': [(0, (-0.05, 0, 0)), (15, (-0.15, 0, 0)), (30, (-0.05, 0, 0))],
		'head': [(0, (-0.1, 0, 0)), (15, (-0.3, 0, 0)), (30, (-0.1, 0, 0))],
		'root.loc': [(0, (0, 0, 0)), (8, (0, 0.06, 0)), (15, (0, 0, 0)), (30, (0, 0, 0))],
	})
	return out


def make_clips(rig):
	rig.animation_data_create()
	for name, (frames, loop, keys) in clips().items():
		act = bpy.data.actions.new(name)
		act.use_fake_user = True
		rig.animation_data.action = act
		for pb in rig.pose.bones:
			pb.rotation_euler = (0, 0, 0)
			pb.location = (0, 0, 0)
		# Every bone is keyed at both ends, so no clip leaves another clip's pose behind.
		for pb in rig.pose.bones:
			for f in (0, frames):
				pb.keyframe_insert('rotation_euler', frame=f)
				pb.keyframe_insert('location', frame=f)
		for bone, ks in keys.items():
			if bone == 'root.loc':
				for f, v in ks:
					rig.pose.bones['root'].location = v
					rig.pose.bones['root'].keyframe_insert('location', frame=f)
				continue
			pb = rig.pose.bones[bone]
			for f, v in ks:
				pb.rotation_euler = v
				pb.keyframe_insert('rotation_euler', frame=f)
		act.use_frame_range = True
		act.frame_start, act.frame_end = 0, frames
		act.use_cyclic = loop
		track = rig.animation_data.nla_tracks.new()
		track.name = name
		track.strips.new(name, 0, act)
		track.mute = True
		rig.animation_data.action = None
	for pb in rig.pose.bones:
		pb.rotation_euler = (0, 0, 0)
		pb.location = (0, 0, 0)


def export(rig, ob, name):
	for o in bpy.data.objects:
		o.select_set(o in (rig, ob))
	rig.name = name
	path = os.path.join(OUT, name + '.glb')
	bpy.ops.export_scene.gltf(
		filepath=path, export_format='GLB', use_selection=True,
		export_animation_mode='ACTIONS', export_force_sampling=True, export_anim_slide_to_zero=True,
		export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_skins=True, export_yup=True, export_apply=False,
		export_cameras=False, export_lights=False)
	rig.name = 'rig'
	return path


def build():
	clear()
	material()
	rig = build_rig()
	make_clips(rig)
	figures = {
		'orc': figure(rig, 'orc_body', orc_parts()),
		'archer': figure(rig, 'archer_body', archer_parts()),
		'swordsman': figure(rig, 'swordsman_body', swordsman_parts()),
	}
	return rig, figures


def export_all(rig, figures):
	return [export(rig, ob, name) for name, ob in figures.items()]


if __name__ == '__main__' or bpy.app.background:
	rig, figures = build()
	export_all(rig, figures)
	bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'figures.blend'))
