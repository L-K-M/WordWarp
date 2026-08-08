import {
  appendArc, arcBand, arcSector, arcStart, circleAt, crescent, ellipseAt, mergePaths, mirrorX, pathBuilder,
  polygon, rect, rotatePath, roundedRect, scalePath, smoothClosedPath, strokeRibbon, translatePath, union,
  withHoles,
} from './stamp-toolkit';
import type { PathData, Point } from '../model/types';

/**
 * The pictorial half of the stamp catalogue: the things a decoration is *of*.
 *
 * Every figure here is drawn in the unit box, from (0, 0) to (1, 1), and scaled by the dispatcher.
 * Authoring at unit size is what makes the numbers legible -- "the eyes sit a third of the way
 * down" is 0.33, not a fraction of some width that is not known until draw time -- and it costs
 * nothing, because `fitToBox` re-normalises every outline to its box afterwards anyway.
 *
 * Each figure is a composition of toolkit primitives rather than a run of hand-placed control
 * points. A pumpkin is a body, a stem and five holes; a cassette is a shell, two reels and the
 * window they turn behind. Written that way a figure can be read, adjusted and argued with. Written
 * as ninety numbers it could only be replaced.
 *
 * The renderer fills with the nonzero rule, so a hole here is a contour wound against what surrounds
 * it. Three consequences shape almost every figure below, and the first two are checked by a grid of
 * winding samples in the tests rather than left to care:
 *
 * - A hole must lie inside the fill it pierces. Outside it there is no +1 to cancel, so it winds to
 *   -1 and renders solid -- and it would widen the path's bounds and shrink the whole figure, since
 *   stamps are normalised to their bounds.
 * - No two holes may cover the same place, because -2 is no closer to zero than -1 is. A stroke
 *   assembled from overlapping pieces, or a cross laid up from two bars, comes back filled exactly
 *   where the pieces meet.
 * - Windings add, so a hole laid across a seam where two filled shapes overlap still leaves one
 *   layer behind. Nothing renders wrong, it simply fails to cut, so a figure keeps its holes clear
 *   of its own seams.
 */

const TAU = Math.PI * 2;
const MID = 0.5;

/** Degrees, because every angle in these figures was chosen by picturing it. */
function deg(value: number): number {
  return (value * Math.PI) / 180;
}

/**
 * A streak: wide and blunt at `from`, tapering to a point at `to`, bowed to one side.
 *
 * The blunt end is meant to be buried in whatever the streak comes out of, so only the taper shows
 * -- which is what separates a comet's tail from an ice cream, and a palm frond from a spike. A
 * lens fat in the middle and pointed at both ends would do neither.
 */
function streak(from: Point, to: Point, width: number, bow: number): PathData {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const at = (along: number, offset: number): Point => [
    from[0] + dx * along + nx * offset,
    from[1] + dy * along + ny * offset,
  ];
  const path = pathBuilder();
  const start = at(0, width / 2);
  const [c1x, c1y] = at(0.40, width / 2 + bow);
  const [c2x, c2y] = at(0.75, width / 4 + bow);
  const [c3x, c3y] = at(0.75, -width / 4 + bow);
  const [c4x, c4y] = at(0.40, -width / 2 + bow);
  const end = at(0, -width / 2);
  path.move(start[0], start[1]);
  path.cubic(c1x, c1y, c2x, c2y, to[0], to[1]);
  path.cubic(c3x, c3y, c4x, c4y, end[0], end[1]);
  path.close();
  return path.build();
}

/** Copies of a figure turned about the box centre, for petals, sprinkles and cog teeth. */
function radialCopies(figure: PathData, count: number, phase = 0): PathData {
  return mergePaths(
    ...Array.from({ length: count }, (_, index) => rotatePath(figure, phase + (index / count) * TAU, MID, MID)),
  );
}

/* ------------------------------------------------------------------ nineties */

/**
 * The acid smiley.
 *
 * Its face is cut out rather than drawn on, which is what lets it take the whole effect stack: the
 * keyline every stamp arrives with traces the eyes and the grin as readily as the rim, and a bevel
 * lights their inner edges. A face painted as separate filled shapes would need its own colour and
 * would sit flat on top of whatever style was applied to the disc.
 */
function smiley(): PathData {
  const eye = ellipseAt(0.33, 0.375, 0.065, 0.105);
  const grin = arcBand({
    cx: MID, cy: 0.45, from: deg(24), to: deg(156),
    outerRx: 0.325, outerRy: 0.325, innerRx: 0.235, innerRy: 0.235,
  });
  return withHoles(circleAt(MID, MID, MID), eye, mirrorX(eye, MID), grin);
}

/**
 * Shutter shades.
 *
 * The slats are the whole point: a lens left as one big opening reads as spectacles, and spectacles
 * are not what anyone means by 1990s glasses. Frame, bridge and brow are separate rectangles rather
 * than one traced outline, so the slats only ever have one layer of fill to cut through -- laying
 * them over a seam between two overlapping pieces would leave them filled in.
 */
function shades(): PathData {
  const lens = roundedRect(0.02, 0.30, 0.45, 0.82, [0.16, 0.08, 0.20, 0.22]);
  const brow = roundedRect(0, 0.22, 1, 0.34, 0.05);
  const bridge = rect(0.42, 0.32, 0.58, 0.46);
  const slats = [0.42, 0.52, 0.62, 0.72].map((centre) => rect(0.09, centre - 0.0225, 0.38, centre + 0.0225));
  const frame = union(brow, bridge, lens, mirrorX(lens, MID));
  return withHoles(frame, ...slats, ...slats.map((slat) => mirrorX(slat, MID)));
}

/**
 * A returnable soda bottle: crown cap, long neck, and two lines where the label sat.
 *
 * The cap is drawn wider than the neck it sits on, which is the whole reason the silhouette reads
 * as a bottle and not a flask -- the step at the lip is the only part of the profile that says
 * something was crimped on top.
 */
function bottle(): PathData {
  const path = pathBuilder();
  path.move(0.35, 0);
  path.line(0.65, 0);
  path.line(0.65, 0.10);
  path.line(0.585, 0.10);
  path.line(0.585, 0.31);
  path.cubic(0.585, 0.42, 0.87, 0.44, 0.87, 0.60);
  path.line(0.87, 0.95);
  path.cubic(0.87, 0.99, 0.84, 1, 0.79, 1);
  path.line(0.21, 1);
  path.cubic(0.16, 1, 0.13, 0.99, 0.13, 0.95);
  path.line(0.13, 0.60);
  path.cubic(0.13, 0.44, 0.415, 0.42, 0.415, 0.31);
  path.line(0.415, 0.10);
  path.line(0.35, 0.10);
  path.close();
  return withHoles(path.build(), rect(0.18, 0.665, 0.82, 0.695), rect(0.18, 0.895, 0.82, 0.925));
}

/**
 * A compact cassette, ruled for a hand-written label.
 *
 * Four levels of winding deep: shell, window, reels, hubs. Nonzero fill handles that without any
 * special casing -- each contour adds or subtracts one, so a reel drawn inside the window comes back
 * to filled and the hub inside it goes hollow again.
 */
function cassette(): PathData {
  const shell = roundedRect(0, 0, 1, 1, 0.09);
  const reel = circleAt(0.32, 0.365, 0.115);
  const hub = circleAt(0.32, 0.365, 0.045);
  const notch = roundedRect(0.18, 0.80, 0.28, 0.94, 0.02);
  return withHoles(
    union(shell, reel, mirrorX(reel, MID)),
    roundedRect(0.09, 0.13, 0.91, 0.60, 0.06),
    hub,
    mirrorX(hub, MID),
    rect(0.16, 0.655, 0.84, 0.685),
    rect(0.16, 0.715, 0.84, 0.745),
    notch,
    mirrorX(notch, MID),
    roundedRect(0.45, 0.80, 0.55, 0.94, 0.02),
  );
}

/** A 3.5-inch diskette: clipped corner, shutter, and a label with two lines written on it. */
function floppy(): PathData {
  const shell = pathBuilder();
  shell.move(0.06, 0);
  shell.line(0.80, 0);
  shell.line(1, 0.20);
  shell.line(1, 0.94);
  shell.cubic(1, 0.98, 0.98, 1, 0.94, 1);
  shell.line(0.06, 1);
  shell.cubic(0.02, 1, 0, 0.98, 0, 0.94);
  shell.line(0, 0.06);
  shell.cubic(0, 0.02, 0.02, 0, 0.06, 0);
  shell.close();
  const slider = rect(0.30, 0.05, 0.44, 0.34);
  const ruling = union(rect(0.20, 0.58, 0.80, 0.605), rect(0.20, 0.68, 0.66, 0.705));
  return withHoles(
    union(shell.build(), slider, ruling),
    roundedRect(0.30, 0.05, 0.72, 0.34, 0.02),
    roundedRect(0.14, 0.46, 0.86, 0.92, 0.03),
  );
}

/** A boombox: carry handle, two woofers, a deck with its reels, and a row of transport keys. */
function boombox(): PathData {
  const handle = arcBand({
    cx: MID, cy: 0.26, from: Math.PI, to: TAU,
    outerRx: 0.24, outerRy: 0.26, innerRx: 0.17, innerRy: 0.19,
  });
  const cone = circleAt(0.21, 0.62, 0.055);
  const spindle = circleAt(0.455, 0.45, 0.028);
  const key = rect(0.41, 0.72, 0.455, 0.79);
  return withHoles(
    union(handle, roundedRect(0, 0.22, 1, 1, 0.07), cone, mirrorX(cone, MID), spindle, mirrorX(spindle, MID)),
    circleAt(0.21, 0.62, 0.155),
    mirrorX(circleAt(0.21, 0.62, 0.155), MID),
    roundedRect(0.40, 0.34, 0.60, 0.56, 0.02),
    key,
    rect(0.4775, 0.72, 0.5225, 0.79),
    mirrorX(key, MID),
  );
}

/** A slice, with the crust scored off from the cheese and three pepperoni cut out of it. */
function pizza(): PathData {
  const slice = pathBuilder();
  slice.move(MID, 0);
  slice.line(0.94, 0.80);
  slice.cubic(0.84, 0.99, 0.16, 0.99, 0.06, 0.80);
  slice.close();
  const score = arcBand({
    cx: MID, cy: 0.05, from: deg(63), to: deg(117),
    outerRx: 0.796, outerRy: 0.796, innerRx: 0.766, innerRy: 0.766,
  });
  const pepperoni = circleAt(0.33, 0.66, 0.075);
  return withHoles(slice.build(), score, circleAt(MID, 0.44, 0.085), pepperoni, mirrorX(pepperoni, MID));
}

/**
 * A six-petal daisy.
 *
 * The petals stop short of the middle and a disc bridges the gap, so the ring cut around the centre
 * has exactly one layer of fill to remove. Running the petals all the way in would double the
 * winding where they overlap and leave six filled wedges across the ring.
 */
function daisy(): PathData {
  const petal = ellipseAt(MID, MID - 0.325, 0.155, 0.175);
  return withHoles(
    union(radialCopies(petal, 6), circleAt(MID, MID, 0.20), circleAt(MID, MID, 0.055)),
    circleAt(MID, MID, 0.135),
  );
}

/** The peace sign: a ring with the three bars laid back inside it. */
function peace(): PathData {
  const bars = union(
    strokeRibbon([[MID, 0.06], [MID, 0.94]], 0.10),
    strokeRibbon([[MID, MID], [0.185, 0.815]], 0.10),
    strokeRibbon([[MID, MID], [0.815, 0.815]], 0.10),
  );
  // The bars go into the filled part, not over the finished ring: laid on top they would have to
  // out-wind the ring's own hole, and inside the union they simply are the ring's spokes.
  return withHoles(union(circleAt(MID, MID, MID), bars), circleAt(MID, MID, 0.385));
}

/** A compact disc: data edge, clamping ring, and the spindle hole through the middle. */
function disc(): PathData {
  return withHoles(
    union(circleAt(MID, MID, MID), circleAt(MID, MID, 0.455), circleAt(MID, MID, 0.20)),
    circleAt(MID, MID, 0.47),
    circleAt(MID, MID, 0.215),
    circleAt(MID, MID, 0.155),
  );
}

/** A broad-winged gamepad with a cut-out d-pad and three face buttons. */
function gamepad(): PathData {
  const shell = pathBuilder();
  shell.move(MID, 0.24);
  shell.cubic(0.66, 0.21, 0.76, 0.14, 0.86, 0.22);
  shell.cubic(0.96, 0.31, 1, 0.71, 0.88, 0.92);
  shell.cubic(0.82, 1, 0.69, 0.80, 0.62, 0.68);
  shell.line(0.38, 0.68);
  shell.cubic(0.31, 0.80, 0.18, 1, 0.12, 0.92);
  shell.cubic(0, 0.71, 0.04, 0.31, 0.14, 0.22);
  shell.cubic(0.24, 0.14, 0.34, 0.21, MID, 0.24);
  shell.close();
  const dpad = polygon([
    [0.265, 0.35], [0.335, 0.35], [0.335, 0.445], [0.43, 0.445],
    [0.43, 0.515], [0.335, 0.515], [0.335, 0.61], [0.265, 0.61],
    [0.265, 0.515], [0.17, 0.515], [0.17, 0.445], [0.265, 0.445],
  ]);
  return scalePath(
    withHoles(
      shell.build(),
      dpad,
      ellipseAt(0.72, 0.40, 0.045, 0.06),
      ellipseAt(0.82, 0.53, 0.045, 0.06),
      ellipseAt(0.62, 0.53, 0.045, 0.06),
    ),
    1,
    0.72,
  );
}

/** Slime hanging off an invisible ledge: a flat top with four rounded fingers of varying reach. */
function drips(): PathData {
  const hem = 0.42;
  const path = pathBuilder();
  path.move(0, 0);
  path.line(1, 0);
  path.line(1, hem);
  path.line(0.94, hem);
  path.cubic(0.95, 0.6, 0.91, 0.74, 0.87, 0.74);
  path.cubic(0.83, 0.74, 0.8, 0.6, 0.8, hem);
  path.line(0.69, hem);
  path.cubic(0.71, 0.72, 0.65, 0.92, 0.61, 0.92);
  path.cubic(0.57, 0.92, 0.53, 0.72, 0.53, hem);
  path.line(0.43, hem);
  path.cubic(0.44, 0.58, 0.41, 0.68, 0.37, 0.68);
  path.cubic(0.33, 0.68, 0.31, 0.58, 0.29, hem);
  path.line(0.18, hem);
  path.cubic(0.2, 0.78, 0.15, 1, 0.11, 1);
  path.cubic(0.07, 1, 0.04, 0.78, 0.04, hem);
  path.line(0, hem);
  path.close();
  return path.build();
}

/* -------------------------------------------------------------------- spooky */

/** Radii of the pumpkin's body, as points a smooth closed curve is run through. */
const PUMPKIN_BODY: readonly Point[] = [
  [MID, 0.16], [0.72, 0.14], [0.90, 0.26], [1, 0.52], [0.94, 0.82], [0.74, 0.99],
  [MID, 1], [0.26, 0.99], [0.06, 0.82], [0, 0.52], [0.10, 0.26], [0.28, 0.14],
];

/** The grin, traced as one contour: two teeth hanging from the top lip and one rising to meet them. */
const PUMPKIN_GRIN: readonly Point[] = [
  [0.16, 0.74], [0.28, 0.74], [0.34, 0.83], [0.40, 0.74], [0.60, 0.74], [0.66, 0.83], [0.72, 0.74],
  [0.84, 0.74], [0.76, 0.89], [0.60, 0.96], [0.55, 0.86], [0.45, 0.86], [0.40, 0.96], [0.24, 0.89],
];

function pumpkin(): PathData {
  const eye = polygon([[0.22, 0.40], [0.44, 0.40], [0.33, 0.60]]);
  const stem = polygon([[0.44, 0.17], [0.42, 0.01], [0.56, 0], [0.58, 0.17]]);
  return withHoles(
    union(smoothClosedPath(PUMPKIN_BODY), stem),
    eye,
    mirrorX(eye, MID),
    polygon([[MID, 0.56], [0.58, 0.70], [0.42, 0.70]]),
    polygon(PUMPKIN_GRIN),
  );
}

/**
 * A sheet ghost: domed head, straight sides, and four scallops for a hem.
 *
 * The hem's joints ride well above where its scallops hang, because a wave read at stamp size needs
 * a good deal more amplitude than looks right in the numbers -- a shallow ripple along the bottom
 * edge reads as a rounded rectangle, not as cloth.
 */
function ghost(): PathData {
  const body = pathBuilder();
  body.move(0, 0.80);
  body.line(0, 0.42);
  body.cubic(0, 0.17, 0.20, 0, MID, 0);
  body.cubic(0.80, 0, 1, 0.17, 1, 0.42);
  body.line(1, 0.80);
  for (let index = 0; index < 4; index += 1) {
    const from = 1 - index * 0.25;
    const to = from - 0.25;
    body.cubic(from - 0.045, 1.10, to + 0.045, 1.10, to, 0.80);
  }
  body.close();
  const eye = ellipseAt(0.32, 0.38, 0.095, 0.13);
  return withHoles(body.build(), eye, mirrorX(eye, MID), ellipseAt(MID, 0.60, 0.075, 0.10));
}

/**
 * A bat, assembled from pieces rather than traced as one silhouette.
 *
 * The scalloped trailing edge is the shape's whole character, and it is much easier to get right on
 * a wing that only has to meet the body somewhere under it than on a single outline that has to
 * arrive back at the ear it started from.
 */
function bat(): PathData {
  const wing = pathBuilder();
  wing.move(0.56, 0.30);
  // Leading edge, bowed up to the tip.
  wing.cubic(0.72, 0.15, 0.87, 0.09, 1, 0.14);
  // Trailing edge: three finger points, each reached by an arc bitten back toward the membrane.
  wing.cubic(0.98, 0.30, 0.96, 0.42, 0.94, 0.58);
  wing.cubic(0.90, 0.44, 0.87, 0.40, 0.82, 0.39);
  wing.cubic(0.83, 0.54, 0.83, 0.66, 0.82, 0.79);
  wing.cubic(0.78, 0.62, 0.74, 0.56, 0.68, 0.53);
  wing.cubic(0.69, 0.66, 0.68, 0.76, 0.66, 0.87);
  wing.cubic(0.63, 0.72, 0.60, 0.62, 0.56, 0.55);
  wing.close();
  const ear = polygon([[0.555, 0.26], [0.60, 0.02], [0.665, 0.30]]);
  return withHoles(
    union(
      circleAt(MID, 0.30, 0.135),
      ellipseAt(MID, 0.52, 0.105, 0.25),
      ear,
      mirrorX(ear, MID),
      wing.build(),
      mirrorX(wing.build(), MID),
    ),
    ellipseAt(0.45, 0.27, 0.032, 0.042),
    ellipseAt(0.55, 0.27, 0.032, 0.042),
  );
}

/** A skull: cranium, cheekbones, a jaw scored off below, and four teeth. */
function skull(): PathData {
  const bone = pathBuilder();
  bone.move(0.06, 0.44);
  bone.cubic(0.06, 0.14, 0.28, 0.02, MID, 0.02);
  bone.cubic(0.72, 0.02, 0.94, 0.14, 0.94, 0.44);
  bone.cubic(0.94, 0.58, 0.88, 0.66, 0.80, 0.70);
  bone.line(0.74, 0.74);
  bone.cubic(0.76, 0.86, 0.70, 0.96, MID, 0.96);
  bone.cubic(0.30, 0.96, 0.24, 0.86, 0.26, 0.74);
  bone.line(0.20, 0.70);
  bone.cubic(0.12, 0.66, 0.06, 0.58, 0.06, 0.44);
  bone.close();
  const socket = ellipseAt(0.31, 0.44, 0.135, 0.155);
  const tooth = rect(0.415, 0.79, 0.445, 0.90);
  return withHoles(
    bone.build(),
    socket,
    mirrorX(socket, MID),
    polygon([[MID, 0.54], [0.585, 0.68], [0.415, 0.68]]),
    rect(0.28, 0.755, 0.72, 0.785),
    tooth,
    rect(0.4775, 0.79, 0.5075, 0.90),
    mirrorX(tooth, MID),
  );
}

/** A round-topped gravestone on its plinth, with a cross cut into the face. */
function tombstone(): PathData {
  const slab = pathBuilder();
  slab.move(0.10, 1);
  slab.line(0.10, 0.48);
  appendArc(slab, { cx: MID, cy: 0.48, rx: 0.40, ry: 0.40, from: Math.PI, to: TAU });
  slab.line(0.90, 1);
  slab.close();
  // Traced as one contour rather than laid up from a vertical and a horizontal bar: two overlapping
  // holes wind back to filled, so crossed bars would leave a filled square sitting in the middle of
  // the cross -- the one place this shape cannot afford one.
  const cross = polygon([
    [0.445, 0.20], [0.555, 0.20], [0.555, 0.30], [0.70, 0.30], [0.70, 0.40], [0.555, 0.40],
    [0.555, 0.62], [0.445, 0.62], [0.445, 0.40], [0.30, 0.40], [0.30, 0.30], [0.445, 0.30],
  ]);
  return withHoles(union(slab.build(), rect(0, 0.86, 1, 1)), cross);
}

/**
 * A corner web: five radials out to the edges of the box, four strands sagging between them.
 *
 * Built from strokes rather than as an outline because a web *is* line work -- and because the
 * spokes have to reach the box edge, not a circle inscribed in it, or the stamp would sit in the
 * middle of its own selection with a quarter of the box empty on two sides.
 */
function web(): PathData {
  const spokes = 5;
  const angles = Array.from({ length: spokes }, (_, index) => (index / (spokes - 1)) * (Math.PI / 2));
  const reach = angles.map((angle) => Math.min(1 / Math.max(Math.cos(angle), 1e-6), 1 / Math.max(Math.sin(angle), 1e-6)));
  const at = (index: number, fraction: number): Point => [
    Math.cos(angles[index]!) * reach[index]! * fraction,
    Math.sin(angles[index]!) * reach[index]! * fraction,
  ];
  const pieces = angles.map((_, index) => strokeRibbon([at(index, 0.04), at(index, 1)], 0.022));
  for (const ring of [0.30, 0.52, 0.74, 0.96]) {
    for (let index = 0; index < spokes - 1; index += 1) {
      const start = at(index, ring);
      const end = at(index + 1, ring);
      const sag: Point = [
        (Math.cos(angles[index]!) * reach[index]! + Math.cos(angles[index + 1]!) * reach[index + 1]!) * ring * 0.43,
        (Math.sin(angles[index]!) * reach[index]! + Math.sin(angles[index + 1]!) * reach[index + 1]!) * ring * 0.43,
      ];
      pieces.push(strokeRibbon([start, sag, end], 0.02));
    }
  }
  return union(...pieces);
}

/** A tapered six-sided coffin with one cross cut cleanly through its lid. */
function coffin(): PathData {
  const cross = polygon([
    [0.465, 0.28], [0.535, 0.28], [0.535, 0.445], [0.67, 0.445],
    [0.67, 0.515], [0.535, 0.515], [0.535, 0.70], [0.465, 0.70],
    [0.465, 0.515], [0.33, 0.515], [0.33, 0.445], [0.465, 0.445],
  ]);
  return withHoles(
    polygon([[0.34, 0], [0.66, 0], [0.88, 0.22], [0.76, 1], [0.24, 1], [0.12, 0.22]]),
    cross,
  );
}

/** A witch hat: a wide elliptical brim and a cone that flopped sideways at the tip. */
function witchHat(): PathData {
  const path = pathBuilder();
  path.move(0.02, 0.8);
  path.cubic(0.12, 0.72, 0.24, 0.7, 0.36, 0.72);
  path.cubic(0.38, 0.48, 0.44, 0.22, 0.56, 0.08);
  path.cubic(0.62, 0.02, 0.7, 0.04, 0.68, 0.12);
  path.cubic(0.66, 0.17, 0.6, 0.15, 0.6, 0.2);
  path.cubic(0.62, 0.4, 0.63, 0.58, 0.64, 0.72);
  path.cubic(0.76, 0.7, 0.88, 0.72, 0.98, 0.8);
  path.cubic(0.82, 0.94, 0.18, 0.94, 0.02, 0.8);
  path.close();
  return path.build();
}

/** A dog bone: a shaft with a pair of knobs at each end, the notch between them doing the work. */
function bone(): PathData {
  const knobs = union(circleAt(0.185, 0.32, 0.15), circleAt(0.185, 0.68, 0.15));
  return union(roundedRect(0.17, 0.4, 0.83, 0.6, 0.08), knobs, mirrorX(knobs, MID));
}

/* -------------------------------------------------------------------- cosmic */

/** A rocket: nose, window, swept fins and a flared nozzle. */
function rocket(): PathData {
  const hull = pathBuilder();
  hull.move(MID, 0);
  hull.cubic(0.62, 0.12, 0.68, 0.24, 0.68, 0.38);
  hull.line(0.68, 0.78);
  hull.cubic(0.68, 0.86, 0.60, 0.90, MID, 0.90);
  hull.cubic(0.40, 0.90, 0.32, 0.86, 0.32, 0.78);
  hull.line(0.32, 0.38);
  hull.cubic(0.32, 0.24, 0.38, 0.12, MID, 0);
  hull.close();
  const fin = polygon([[0.32, 0.48], [0.02, 1], [0.32, 0.82]]);
  return withHoles(
    union(hull.build(), fin, mirrorX(fin, MID), polygon([[0.38, 0.86], [0.62, 0.86], [0.68, 1], [0.32, 1]])),
    circleAt(MID, 0.34, 0.115),
    rect(0.36, 0.60, 0.64, 0.635),
  );
}

/**
 * A ringed planet.
 *
 * The ring is two sectors of an elliptical band, not a full annulus laid over the disc: an annulus
 * would carry its own hole across the planet and punch two lens-shaped gaps out of it. Each sector
 * runs from just inside the silhouette on one side to just inside it on the other, so the ring
 * reads as passing behind the planet with nothing to clip.
 */
function planet(): PathData {
  const band = { cx: MID, cy: MID, rotation: deg(-14), outerRx: 0.50, outerRy: 0.175, innerRx: 0.375, innerRy: 0.131 };
  return union(
    circleAt(MID, MID, 0.30),
    arcBand({ ...band, from: deg(100), to: deg(260) }),
    arcBand({ ...band, from: deg(-80), to: deg(80) }),
  );
}

/** A crescent moon, as the lune left when one disc is bitten out of another. */
function moon(): PathData {
  return translatePath(crescent(MID, 0.43, 0.21), MID, MID);
}

/**
 * A comet: a head with its tail swept back into the corner.
 *
 * The tail starts at the head's own centre rather than at its edge, so its blunt end is buried and
 * the union shows only the taper. Meeting the rim instead would leave a chord across it, and a
 * circle with a straight-sided cone attached reads as an ice cream, not a comet.
 */
function comet(): PathData {
  return union(circleAt(0.77, 0.25, 0.22), streak([0.77, 0.25], [0, 1], 0.40, 0.05));
}

/** A flying saucer: dome, hull, underside lens, and three ports along the rim. */
function saucer(): PathData {
  const port = circleAt(0.22, 0.65, 0.047);
  return withHoles(
    union(
      arcSector({ cx: MID, cy: 0.575, rx: 0.26, ry: 0.30, from: Math.PI, to: TAU }),
      ellipseAt(MID, 0.60, MID, 0.155),
      arcSector({ cx: MID, cy: 0.72, rx: 0.15, ry: 0.13, from: 0, to: Math.PI }),
    ),
    port,
    circleAt(MID, 0.65, 0.047),
    mirrorX(port, MID),
  );
}

/** A panelled satellite with twin arrays, a faceted bus and a mast-mounted beacon. */
function satellite(): PathData {
  const leftPanel = rect(0, 0.30, 0.29, 0.70);
  const rightPanel = rect(0.71, 0.30, 1, 0.70);
  const mast = strokeRibbon([[0.53, 0.28], [0.70, 0.07]], 0.035);
  return withHoles(
    union(
      leftPanel,
      rightPanel,
      strokeRibbon([[0.25, MID], [0.39, MID]], 0.05),
      strokeRibbon([[0.61, MID], [0.75, MID]], 0.05),
      polygon([[0.39, 0.25], [0.61, 0.25], [0.67, 0.75], [0.33, 0.75]]),
      mast,
      circleAt(0.72, 0.055, 0.045),
    ),
    rect(0.08, 0.35, 0.11, 0.65),
    rect(0.18, 0.35, 0.21, 0.65),
    rect(0.79, 0.35, 0.82, 0.65),
    rect(0.89, 0.35, 0.92, 0.65),
    ellipseAt(MID, MID, 0.07, 0.09),
  );
}

/** A four-point twinkle: straight points pulled in by cubics that dip almost to the centre. */
function sparkle(): PathData {
  const path = pathBuilder();
  path.move(MID, 0);
  path.cubic(0.55, 0.32, 0.68, 0.45, 1, MID);
  path.cubic(0.68, 0.55, 0.55, 0.68, MID, 1);
  path.cubic(0.45, 0.68, 0.32, 0.55, 0, MID);
  path.cubic(0.32, 0.45, 0.45, 0.32, MID, 0);
  path.close();
  return path.build();
}

/* -------------------------------------------------------------------- sweets */

/**
 * An ice cream: three scoops over a cone, scored below the melt line.
 *
 * The side lobes overlap the middle one deeply and sit only a little lower, so the scoop reads as
 * one soft mass with two shoulders. Spaced further apart their circles cross high and leave a sharp
 * notch either side of the middle lobe, and a scoop with two notches in its crown is a heart.
 */
function cone(): PathData {
  const scoop = circleAt(0.28, 0.30, 0.17);
  return withHoles(
    union(circleAt(MID, 0.24, 0.24), scoop, mirrorX(scoop, MID), polygon([[0.22, 0.44], [0.78, 0.44], [MID, 1]])),
    rect(0.33, 0.56, 0.67, 0.585),
    rect(0.385, 0.70, 0.615, 0.725),
  );
}

/** A doughnut: a scalloped ring with sprinkles cut out of the glaze. */
function donut(): PathData {
  const sprinkle = roundedRect(MID + 0.265, MID - 0.019, MID + 0.375, MID + 0.019, 0.019);
  return withHoles(
    smoothClosedPath(radialPointsAt(7, 0.91)),
    circleAt(MID, MID, 0.175),
    radialCopies(sprinkle, 6, deg(20)),
  );
}

/** Points at alternating radii around the unit box's inscribed circle. */
function radialPointsAt(points: number, innerRatio: number): Point[] {
  return Array.from({ length: points * 2 }, (_, index): Point => {
    const angle = (index / (points * 2)) * TAU - Math.PI / 2;
    const radius = (index % 2 === 0 ? 1 : innerRatio) * MID;
    return [MID + Math.cos(angle) * radius, MID + Math.sin(angle) * radius];
  });
}

/** A lollipop: a disc with its swirl grooved out, on a stick. */
function lolly(): PathData {
  const turns = 2;
  const samples = 140;
  const spiral: Point[] = Array.from({ length: samples + 1 }, (_, index) => {
    const angle = (index / samples) * turns * TAU;
    const radius = 0.045 + (0.215 * index) / samples;
    return [MID + Math.cos(angle) * radius, 0.335 + Math.sin(angle) * radius];
  });
  return withHoles(
    union(circleAt(MID, 0.335, 0.335), rect(0.465, 0.335, 0.535, 1)),
    strokeRibbon(spiral, 0.055),
  );
}

/** A wrapped sweet: a centre oval with two crimped wrapper ends. */
function candy(): PathData {
  const wrapper = polygon([[0.05, 0.28], [0.27, 0.38], [0.27, 0.62], [0.05, 0.72], [0.12, 0.5]]);
  return union(ellipseAt(MID, MID, 0.27, 0.26), wrapper, mirrorX(wrapper, MID));
}

/** A ridged cake wrapper under an asymmetric four-lobed cap of frosting. */
function cupcake(): PathData {
  const frosting = pathBuilder();
  frosting.move(0.08, 0.43);
  frosting.cubic(0.02, 0.34, 0.12, 0.23, 0.28, 0.27);
  frosting.cubic(0.25, 0.12, 0.40, 0.05, MID, 0.17);
  frosting.cubic(0.60, 0, 0.77, 0.09, 0.73, 0.26);
  frosting.cubic(0.89, 0.22, 0.99, 0.34, 0.92, 0.43);
  frosting.close();
  return union(
    frosting.build(),
    polygon([[0.12, 0.40], [0.88, 0.40], [0.76, 1], [0.24, 1]]),
  );
}

/** Two cherries on joined stems, with a little leaf streaking off the top. */
function cherry(): PathData {
  const leftStem = strokeRibbon([[0.3, 0.6], [0.38, 0.36], [0.52, 0.14]], 0.045);
  const rightStem = strokeRibbon([[0.7, 0.52], [0.64, 0.3], [0.52, 0.14]], 0.045);
  const leaf = streak([0.52, 0.14], [0.76, 0.03], 0.1, 0.04);
  return union(circleAt(0.3, 0.74, 0.17), circleAt(0.7, 0.66, 0.17), leftStem, rightStem, leaf);
}

/* --------------------------------------------------------------------- scene */

/**
 * The slatted sun of every sunset poster.
 *
 * Each slat is cut to the disc's own chord at the point where it first meets it, so the cut always
 * runs clean through instead of leaving hairline slivers at the ends -- and because the slats
 * thicken faster than the bands do, the disc dissolves toward the bottom the way it should.
 */
function sun(): PathData {
  const slats = [[0.545, 0.022], [0.635, 0.032], [0.725, 0.042], [0.812, 0.052], [0.895, 0.060]];
  return withHoles(
    circleAt(MID, MID, MID),
    ...slats.map(([centre, thickness]) => discBand(centre! - thickness! / 2, centre! + thickness! / 2)),
  );
}

/**
 * The slice of the unit box's inscribed circle between two heights, bounded by the circle itself.
 *
 * A plain rectangle would have been shorter, and wrong in both directions: cut to the disc's widest
 * chord it overhangs the rim, and an overhanging hole does not vanish harmlessly -- outside the
 * disc it is the only contour there, so it winds to -1 and nonzero fills it, hanging square ears
 * off the sun. Cut to the narrowest chord instead it stops short, and each band keeps a hairline
 * bridge at both ends where the cut failed to go through.
 */
function discBand(top: number, bottom: number): PathData {
  const path = pathBuilder();
  const right = { cx: MID, cy: MID, rx: MID, ry: MID, from: Math.asin((top - MID) / MID), to: Math.asin((bottom - MID) / MID) };
  const left = { ...right, from: Math.PI - right.to, to: Math.PI - right.from };
  const start = arcStart(right);
  path.move(start[0], start[1]);
  appendArc(path, right);
  const back = arcStart(left);
  path.line(back[0], back[1]);
  appendArc(path, left);
  path.close();
  return path.build();
}

/**
 * A palm: a leaning trunk, six drooping fronds, and two coconuts tucked into the crown.
 *
 * Fronds are streaks rather than leaves -- broad where they leave the crown and tapering to a tip --
 * because a frond fat in the middle and pointed at both ends reads as a spike, and six spikes round
 * a stem is an agave. The bow on each is what makes them hang instead of radiate.
 */
function palm(): PathData {
  const trunk = pathBuilder();
  trunk.move(0.35, 1);
  trunk.cubic(0.40, 0.76, 0.43, 0.60, 0.495, 0.44);
  trunk.line(0.605, 0.48);
  trunk.cubic(0.535, 0.64, 0.51, 0.78, 0.53, 1);
  trunk.close();
  const crown: Point = [0.55, 0.42];
  const tips: Array<[Point, number]> = [
    [[0.02, 0.30], 0.16], [[0.08, 0.05], 0.12], [[0.36, 0], -0.09],
    [[0.70, 0.01], -0.10], [[0.95, 0.09], -0.14], [[1, 0.34], -0.18],
  ];
  return union(
    trunk.build(),
    ...tips.map(([tip, bow]) => streak(crown, tip, 0.17, bow)),
    circleAt(0.50, 0.50, 0.048),
    circleAt(0.60, 0.52, 0.042),
  );
}

/** A flame, with a second tongue cut out of its heart. */
function flame(): PathData {
  const outer = pathBuilder();
  outer.move(MID, 0);
  outer.cubic(0.72, 0.22, 0.84, 0.40, 0.84, 0.58);
  outer.cubic(0.84, 0.82, 0.68, 1, MID, 1);
  outer.cubic(0.32, 1, 0.16, 0.82, 0.16, 0.58);
  outer.cubic(0.16, 0.40, 0.24, 0.28, 0.34, 0.16);
  outer.cubic(0.34, 0.30, 0.40, 0.38, MID, 0.42);
  outer.cubic(0.46, 0.28, 0.46, 0.12, MID, 0);
  outer.close();
  const heart = pathBuilder();
  heart.move(MID, 0.50);
  heart.cubic(0.66, 0.62, 0.70, 0.72, 0.70, 0.80);
  heart.cubic(0.70, 0.91, 0.61, 0.98, MID, 0.98);
  heart.cubic(0.39, 0.98, 0.30, 0.91, 0.30, 0.80);
  heart.cubic(0.30, 0.72, 0.34, 0.62, MID, 0.50);
  heart.close();
  return withHoles(outer.build(), heart.build());
}

/** A cloud: three lobes over a flat base. */
function cloud(): PathData {
  return union(
    circleAt(0.22, 0.62, 0.22),
    circleAt(0.44, 0.42, 0.30),
    circleAt(0.72, 0.54, 0.26),
    roundedRect(0.06, 0.60, 0.96, 0.86, 0.13),
  );
}

/** Four soft wings around a slim body, with eye-spots cut from the upper pair. */
function butterfly(): PathData {
  const upper = rotatePath(ellipseAt(0.27, 0.32, 0.27, 0.19), deg(33), 0.27, 0.32);
  const lower = rotatePath(ellipseAt(0.31, 0.70, 0.19, 0.24), deg(-16), 0.31, 0.70);
  const wingSpot = ellipseAt(0.23, 0.30, 0.045, 0.07);
  return withHoles(
    union(
      upper,
      mirrorX(upper, MID),
      lower,
      mirrorX(lower, MID),
      ellipseAt(MID, 0.56, 0.075, 0.35),
      strokeRibbon([[0.48, 0.24], [0.35, 0]], 0.025),
      strokeRibbon([[0.52, 0.24], [0.65, 0]], 0.025),
    ),
    wingSpot,
    mirrorX(wingSpot, MID),
  );
}

/** A speech bubble with its tail down and to the left. */
function speech(): PathData {
  return union(roundedRect(0, 0, 1, 0.72, 0.19), polygon([[0.22, 0.58], [0.08, 1], [0.54, 0.68]]));
}

/**
 * A ribbon banner: a plaque with two swallowtailed ends dropping away behind it.
 *
 * The ends overlap a good part of the plaque's width rather than butting against its edge. Joined
 * at the very corner they read as legs under a table; carried well underneath, the step where the
 * plaque's lower edge meets them reads as the fold it is meant to be.
 */
function banner(): PathData {
  const tail = polygon([[0, 0.09], [0.32, 0.09], [0.32, 0.43], [0, 0.43], [0.11, 0.26]]);
  return union(rect(0.24, 0, 0.76, 0.34), tail, mirrorX(tail, MID));
}

/**
 * A brilliant-cut gem, with the girdle and four facets scored into it.
 *
 * Every score stops just short of the next. Two holes do not make a deeper hole -- they wind back
 * to filled -- so a facet run into the girdle, or a pair of pavilion facets run together at the
 * point, would come out as a bright blob exactly where the lines were meant to meet.
 */
function gem(): PathData {
  const crownFacet = strokeRibbon([[0.26, 0.02], [0.158, 0.295]], 0.026);
  const pavilionFacet = strokeRibbon([[0.158, 0.345], [0.475, 0.855]], 0.026);
  return withHoles(
    polygon([[0.26, 0], [0.74, 0], [1, 0.32], [MID, 1], [0, 0.32]]),
    strokeRibbon([[0.05, 0.32], [0.95, 0.32]], 0.026),
    crownFacet,
    mirrorX(crownFacet, MID),
    pavilionFacet,
    mirrorX(pavilionFacet, MID),
  );
}

/** Every pictorial figure, in the unit box. */
export const STAMP_FIGURES = {
  smiley, shades, bottle, cassette, floppy, boombox, pizza, daisy, peace, disc, gamepad, drips,
  pumpkin, ghost, bat, skull, tombstone, web, coffin, bone, 'witch-hat': witchHat,
  rocket, planet, moon, comet, saucer, satellite, sparkle,
  cone, donut, lolly, candy, cupcake, cherry,
  sun, palm, flame, cloud, butterfly, speech, banner, gem,
} satisfies Record<string, () => PathData>;

export type StampFigureId = keyof typeof STAMP_FIGURES;
