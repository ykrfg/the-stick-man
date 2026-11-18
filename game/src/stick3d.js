// Stick figures in 3D, built to move with human-like suppleness rather than like
// hinged puppets. Each figure is a small rig: a pelvis, a jointed spine (pelvis ->
// chest -> head, each able to lean and twist), and two-segment arms and legs with
// shoulder/elbow and hip/knee joints. Callers set pose *targets* (speed, crouch,
// drive, aim, down, a punch trigger); the figure damps every value toward its
// target and solves the joints procedurally each frame — walk and run cycles with
// opposite arm swing and knee lift, a punch with anticipation, strike and
// recovery, a crouch for climbing into cars, a settled driving pose, and a relaxed
// breathing idle. No animation assets: it is all math, and it is cheap.
//
// Per the character reference sheet there are two figure types. Hero type: ONLY
// the head is a white-filled disc with a black outline — the torso, arms, legs,
// hands and feet are solid black stick lines. Rival type: the whole figure,
// head included, is solid black. Faces are mouth-only: a small plane on the head
// carries one of six mouth shapes (neutral, grin, angry, shout, smug,
// frustrated), swapped by name — dark shapes on the white head, light on black.
import * as THREE from 'three';

export const EXPRESSIONS = ['neutral', 'grin', 'angry', 'shout', 'smug', 'frustrated'];

const INK = 0x17181c;

/** Shared 4-step gradient map that gives MeshToonMaterial its cel bands. */
let gradientMap = null;
export function toonGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([90, 150, 205, 255]);
  gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const toonCache = new Map();
/** A cached MeshToonMaterial in the given colour. */
export function toonMat(color) {
  if (!toonCache.has(color)) {
    toonCache.set(color, new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() }));
  }
  return toonCache.get(color);
}

const basicCache = new Map();
/** A cached MeshBasicMaterial (outlines, lights, flat overlays). */
export function basicMat(color) {
  if (!basicCache.has(color)) basicCache.set(color, new THREE.MeshBasicMaterial({ color }));
  return basicCache.get(color);
}

/** An inverted-hull outline for a mesh: same geometry, black, back-side, a bit larger. */
function outline(mesh, scale = 1.14) {
  const hull = new THREE.Mesh(mesh.geometry, basicMat(INK));
  hull.material = basicMat(INK);
  hull.scale.setScalar(scale);
  hull.material.side = THREE.BackSide;
  mesh.add(hull);
  return hull;
}

/** Mouth shapes drawn once onto small canvases, one texture per expression. */
let mouthTextures = null;
function getMouthTextures() {
  if (mouthTextures) return mouthTextures;
  mouthTextures = {};
  for (const expr of EXPRESSIONS) {
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    const x = 48;
    const y = 60;
    ctx.beginPath();
    if (expr === 'grin') {
      ctx.arc(x, y - 6, 17, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else if (expr === 'smug') {
      ctx.arc(x + 4, y - 2, 15, 0.1 * Math.PI, 0.62 * Math.PI);
      ctx.stroke();
    } else if (expr === 'angry') {
      ctx.moveTo(x - 15, y + 5);
      ctx.lineTo(x, y - 6);
      ctx.lineTo(x + 15, y + 5);
      ctx.stroke();
    } else if (expr === 'frustrated') {
      for (let i = 0; i < 3; i += 1) {
        ctx.moveTo(x - 17 + i * 15, y);
        ctx.quadraticCurveTo(x - 9 + i * 15, y - 9, x - 1 + i * 15, y);
      }
      ctx.stroke();
    } else if (expr === 'shout') {
      ctx.ellipse(x, y, 10, 15, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.moveTo(x - 13, y);
      ctx.lineTo(x + 13, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 2;
    mouthTextures[expr] = tex;
  }
  return mouthTextures;
}

const sphereGeo = new THREE.SphereGeometry(1, 18, 14);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10);

/** A limb segment: a pivot group with a unit cylinder scaled to (radius, length). */
function segment(radius, length, material, jointRadius) {
  const pivot = new THREE.Group();
  const cyl = new THREE.Mesh(cylGeo, material);
  cyl.scale.set(radius, length, radius);
  cyl.position.y = -length / 2;
  pivot.add(cyl);
  if (jointRadius > 0) {
    const joint = new THREE.Mesh(sphereGeo, material);
    joint.scale.setScalar(jointRadius);
    pivot.add(joint);
  }
  return pivot;
}

/**
 * Build one stick figure. opts: {
 *   fill: 'white' (hero type: white head disc, black stick body) | 'black' (rival: all black),
 *   headColor: explicit head colour override (pedestrians wear off-whites so
 *     the hero's pure white stays his alone),
 *   cap: a colour for a flat cap (police officers), or null,
 *   scale: overall size multiplier.
 * }
 * The returned figure exposes group (place and yaw this), tilt, setExpression,
 * triggerPunch, setGun, and update(dt, time) which solves the pose from fig.target:
 * { speed: 0..1.5 locomotion amount, crouch, drive, aim, down } each 0..1.
 */
export function createFigure(opts = {}) {
  const black = opts.fill === 'black';
  // Only the head differs between the two types: a white disc for the hero
  // type, black for rivals. Trunk, pelvis, chest and hands are solid black
  // stick for BOTH types, exactly like the limbs.
  const headMat = toonMat(opts.headColor ?? (black ? INK : 0xffffff));
  const bodyMat = toonMat(INK);
  const limbMat = toonMat(INK);
  // Lean proportions per the character reference sheet: limbs and torso are thin
  // line-like strokes, and the round head is about a fifth of the total height.
  const limbR = black ? 1.25 : 1.05;

  const group = new THREE.Group();
  const tilt = new THREE.Group();
  group.add(tilt);

  // Soft blob shadow that stays flat on the ground whatever the body does.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(10, 20),
    new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false,
      // The blob floats above the whole ground-plane ladder (roads and
      // crossing squares included) and polygonOffset keeps it winning the
      // depth test against whichever surface is underneath.
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.62;
  group.add(shadow);

  const HIP_H = 16;
  const pelvis = new THREE.Group();
  pelvis.position.y = HIP_H;
  tilt.add(pelvis);
  const pelvisBall = new THREE.Mesh(sphereGeo, bodyMat);
  pelvisBall.scale.set(2.1, 1.8, 2.1);
  pelvis.add(pelvisBall);

  // Legs: hip pivot -> thigh -> knee pivot -> shin -> foot.
  function makeLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(0, -0.5, side * 1.7);
    const thigh = segment(limbR, 8, limbMat, limbR * 1.05);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -8;
    thigh.add(knee);
    const shin = segment(limbR * 0.88, 8, limbMat, 0);
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.2, 2.1), limbMat);
    foot.position.set(1.1, -8.35, 0);
    shin.add(foot);
    pelvis.add(hip);
    return { hip, knee };
  }
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // Spine: a group that leans and twists; the chest rides on top of it.
  const spine = new THREE.Group();
  spine.position.y = 1;
  pelvis.add(spine);
  const torso = new THREE.Mesh(cylGeo, bodyMat);
  torso.scale.set(1.3, 10.5, 1.3);
  torso.position.y = 5.2;
  spine.add(torso);
  const chestBall = new THREE.Mesh(sphereGeo, bodyMat);
  chestBall.scale.set(2.3, 2.0, 2.3);
  chestBall.position.y = 10.4;
  spine.add(chestBall);

  // Arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand.
  // Segment lengths are tuned to the reference sheet: a relaxed arm hangs to
  // about mid-thigh (upper 8.2 + forearm/hand 7.9 from the shoulder), not to
  // the knees as the first, longer rig did. The pivots sit at z +-2.45, just
  // outside the chest ball's +-2.3, and update() adds a slight outward rest
  // angle, so the hanging shaft clears the torso instead of merging into it.
  function makeArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, 9.8, side * 2.45);
    const upper = segment(limbR, 8.2, limbMat, limbR * 1.05);
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -8.2;
    upper.add(elbow);
    const fore = segment(limbR * 0.88, 7.4, limbMat, 0);
    elbow.add(fore);
    const hand = new THREE.Mesh(sphereGeo, limbMat);
    hand.scale.setScalar(1.6);
    hand.position.y = -7.9;
    fore.add(hand);
    spine.add(shoulder);
    return { shoulder, elbow, fore, hand, side };
  }
  const armL = makeArm(1);
  const armR = makeArm(-1);

  // Head on its own pivot so it can counter-tilt and look around.
  const neck = new THREE.Group();
  neck.position.y = 12.6;
  spine.add(neck);
  const head = new THREE.Mesh(sphereGeo, headMat);
  head.scale.setScalar(4.1);
  head.position.set(0.5, 3.0, 0);
  neck.add(head);
  if (!black) outline(head, 1.16);

  // Mouth plane just in front of the face.
  const mouthMat = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    color: black ? 0xffffff : INK,
  });
  mouthMat.map = getMouthTextures().neutral;
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 5.6), mouthMat);
  mouth.position.set(4.75, 2.3, 0);
  mouth.rotation.y = Math.PI / 2;
  neck.add(mouth);

  if (opts.cap) {
    const capMesh = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.6, 1.5, 14), toonMat(opts.cap));
    capMesh.position.set(0.55, 6.35, 0);
    capMesh.rotation.z = -0.1;
    neck.add(capMesh);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.5, 4.6), toonMat(opts.cap));
    brim.position.set(3.6, 5.5, 0);
    neck.add(brim);
  }

  // A little pistol that appears in the right hand when the figure is armed.
  const gun = new THREE.Group();
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.0, 1.7), basicMat(0x26262c));
  gunBody.position.set(3.4, 0.35, 0);
  const gunGrip = new THREE.Mesh(new THREE.BoxGeometry(2.0, 3.6, 1.6), basicMat(0x26262c));
  gunGrip.position.set(0.3, -1.7, 0);
  gun.add(gunBody, gunGrip);
  gun.position.y = -7.9;
  gun.visible = false;
  armR.fore.add(gun);

  if (opts.scale) group.scale.setScalar(opts.scale);

  const fig = {
    group,
    tilt,
    shadow,
    parts: { pelvis, spine, neck, legL, legR, armL, armR },
    target: { speed: 0, crouch: 0, drive: 0, aim: 0, down: 0 },
    cur: { speed: 0, crouch: 0, drive: 0, aim: 0, down: 0 },
    phase: Math.random() * Math.PI * 2,
    swaySeed: Math.random() * 100,
    punchT: -1,
    punchArm: 'R',
    expr: 'neutral',
    setExpression(name) {
      if (EXPRESSIONS.includes(name)) {
        fig.expr = name;
        mouthMat.map = getMouthTextures()[name];
        mouthMat.needsUpdate = true;
      }
    },
    setGun(on) {
      gun.visible = on;
    },
    triggerPunch() {
      if (fig.punchT < 0) {
        fig.punchT = 0;
        fig.punchArm = fig.punchArm === 'R' ? 'L' : 'R';
      }
    },
    update,
  };

  const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;

  /** Punch arm curves at phase p (0..1): shoulder shove, elbow bend, spine twist. */
  const punchPose = (p) => {
    if (p <= 0 || p >= 1) return { shove: 0, bend: 0, tw: 0 };
    if (p < 0.3) {
      const k = easeOut(p / 0.3);
      return { shove: -0.62 * k, bend: 1.5 * k, tw: -0.38 * k };
    }
    if (p < 0.55) {
      const k = easeIn((p - 0.3) / 0.25);
      return { shove: -0.62 + 2.3 * k, bend: 1.5 - 1.44 * k, tw: -0.38 + 0.68 * k };
    }
    const k = easeOut((p - 0.55) / 0.45);
    return { shove: 1.68 * (1 - k), bend: 0.06 + 0.3 * k, tw: 0.3 * (1 - k) };
  };
  /** Normalised hip-drive curve over the punch: -1 wound back, +1 driven through. */
  const driveAt = (p) => {
    if (p <= 0 || p >= 1) return 0;
    if (p < 0.3) return -easeOut(p / 0.3);
    if (p < 0.55) return -1 + 2 * easeIn((p - 0.3) / 0.25);
    return 1 - easeOut((p - 0.55) / 0.45);
  };

  /** Solve every joint from the damped pose values. Call once per frame. */
  function update(dt, time) {
    const c = fig.cur;
    const t = fig.target;
    c.speed = damp(c.speed, t.speed, 9, dt);
    c.crouch = damp(c.crouch, t.crouch, 10, dt);
    c.drive = damp(c.drive, t.drive, 8, dt);
    c.aim = damp(c.aim, t.aim, 12, dt);
    c.down = damp(c.down, t.down, 7, dt);

    const speed = Math.min(1.35, c.speed);
    if (speed > 0.03 && c.down < 0.3) fig.phase += dt * (5.4 + 6.8 * speed);
    const ph = fig.phase;
    const sw = Math.sin(ph);
    const sw2 = Math.sin(ph + Math.PI);
    const gait = Math.min(1, speed); // 0 idle .. 1 full run blend

    // --- Vertical: bob from the gait, sink from crouch / seat / fall. ---
    const bob = Math.abs(Math.sin(ph)) * 1.5 * gait;
    const breathe = Math.sin(time * 1.7 + fig.swaySeed) * 0.22 * (1 - gait);
    pelvis.position.y = HIP_H + bob + breathe - c.crouch * 6.5 - c.drive * 13;
    pelvis.position.x = 0; // the punch block below may drive these forward/sideways
    pelvis.position.z = 0;
    pelvis.rotation.x = Math.sin(ph * 2 + fig.swaySeed) * 0.03 * gait; // gentle roll
    pelvis.rotation.y = Math.sin(time * 0.43 + fig.swaySeed) * 0.05 * (1 - gait); // idle weight shift

    // --- Legs: swing with knee lift while the foot is in the air. ---
    const amp = 0.62 * gait;
    const kneeLift = (s) => Math.max(0, -Math.sin(s - 0.85)) * 0.95 * gait + 0.06 * gait;
    legL.hip.rotation.z = sw * amp - c.crouch * 0.8 - c.drive * 1.35 + c.down * 0.15;
    legR.hip.rotation.z = sw2 * amp - c.crouch * 0.8 - c.drive * 1.35 - c.down * 0.1;
    legL.knee.rotation.z = -kneeLift(ph) - c.crouch * 1.65 - c.drive * 1.45;
    legR.knee.rotation.z = -kneeLift(ph + Math.PI) - c.crouch * 1.65 - c.drive * 1.45;

    // --- Spine: lean into the movement, settle when seated, hunch when crouched. ---
    let twist = Math.sin(ph) * 0.09 * gait;
    spine.rotation.z = -(0.1 * gait + c.crouch * 0.34 + c.drive * 0.1 - c.down * 0.2);
    spine.rotation.x = Math.sin(ph * 2) * 0.028 * gait;
    neck.rotation.z = 0.06 * gait + c.crouch * -0.12; // head counter-tilt keeps the face level
    neck.rotation.y = Math.sin(time * 0.31 + fig.swaySeed * 2) * 0.14 * (1 - gait) * (1 - c.aim);
    chestBall.scale.y = 2.0 + Math.sin(time * 1.7 + fig.swaySeed) * 0.07 * (1 - gait); // breathing

    // --- Arms: swing opposite to the legs, elbows softly bent. ---
    let shL = sw2 * amp * 0.85;
    let shR = sw * amp * 0.85;
    let elL = 0.3 + Math.max(0, Math.sin(ph + Math.PI - 0.7)) * 0.35 * gait + c.crouch * 0.25;
    let elR = 0.3 + Math.max(0, Math.sin(ph - 0.7)) * 0.35 * gait + c.crouch * 0.25;
    // Driving: both arms forward and bent onto the wheel, settled.
    shL = shL * (1 - c.drive) + 0.92 * c.drive;
    shR = shR * (1 - c.drive) + 0.92 * c.drive;
    elL = elL * (1 - c.drive) + 0.55 * c.drive;
    elR = elR * (1 - c.drive) + 0.55 * c.drive;
    // Aiming: the gun arm points forward, the other tucks in.
    shR = shR * (1 - c.aim) + 1.5 * c.aim;
    elR = elR * (1 - c.aim) + 0.06 * c.aim;
    elL = elL * (1 - c.aim) + 0.7 * c.aim;
    // Knocked out: arms flop.
    shL = shL * (1 - c.down) + 0.5 * c.down;
    shR = shR * (1 - c.down) - 0.4 * c.down;

    // --- Punch: anticipation (wind back + twist), strike (extend +
    // untwist), recovery — driven from the hips, not just the arm. The
    // pelvis yaws INTO the punch (the punching-side hip drives forward),
    // the weight shifts onto that leg with a dip and a forward drive, and
    // the spine twist follows the pelvis a beat later (the whip), so the
    // shoulder rides the combined rotation forward. `side` mirrors every
    // term for left and right punches. ---
    if (fig.punchT >= 0) {
      fig.punchT += dt / 0.38;
      const pt = fig.punchT;
      if (pt >= 1) {
        fig.punchT = -1;
      } else {
        const arm = fig.punchArm === 'R' ? 'R' : 'L';
        const side = arm === 'L' ? 1 : -1; // z-side of the punching arm
        const pose = punchPose(pt);
        if (arm === 'R') {
          shR = pose.shove + shR * 0.15;
          elR = pose.bend;
        } else {
          shL = pose.shove + shL * 0.15;
          elL = pose.bend;
        }
        twist += side * punchPose(pt - 0.07).tw; // spine lags the pelvis: whip
        const hd = driveAt(pt);
        const strike = Math.max(0, hd);
        const load = Math.max(0, -hd);
        pelvis.rotation.y += side * 0.44 * hd;
        pelvis.position.z += side * 1.0 * hd; // weight onto the punching-side leg
        pelvis.position.x += 1.5 * strike; // root drives forward through the hit
        pelvis.position.y -= 1.3 * strike + 0.5 * load; // dip: front knee bends, rear loads
        spine.rotation.z -= 0.1 * strike; // torso leans into the strike
        const frontLeg = side > 0 ? legL : legR;
        const rearLeg = side > 0 ? legR : legL;
        frontLeg.knee.rotation.z -= 0.34 * strike;
        frontLeg.hip.rotation.z += 0.12 * strike;
        rearLeg.hip.rotation.z -= 0.1 * strike;
      }
    }
    spine.rotation.y = twist;

    armL.shoulder.rotation.z = shL;
    armR.shoulder.rotation.z = shR;
    armL.elbow.rotation.z = elL;
    armR.elbow.rotation.z = elR;
    // Arms hang OUT from the body on a slight abduction, so the shaft
    // clears the torso, chest and pelvis instead of sitting inside their
    // silhouette. (For a hanging arm, rotation.x of -side tips the tip
    // away from the midline; the old +-0.1 did the opposite and tilted
    // both arms INTO the body.) Knocked out, they flop further out.
    armL.shoulder.rotation.x = -armL.side * (0.17 + c.down * 0.5);
    armR.shoulder.rotation.x = -armR.side * (0.17 + c.down * 0.5);

    // --- Whole-body fall when knocked out. ---
    tilt.rotation.x = -1.5 * easeOut(Math.min(1, c.down));
    // Seated drivers also sink at the root, so the head stays inside the cabin.
    tilt.position.y = -2 * c.down - 5 * c.drive;
    shadow.material.opacity = 0.2 * (1 - c.drive);
  }

  return fig;
}
