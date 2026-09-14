/**
 * ShipBuilder.js
 * ---------------------------------------------------------------
 * Shared low-poly sci-fi ship construction from three.js primitives.
 * Builds every hull with a small set of reusable, shareable base
 * geometries so the scene stays cheap even with many ships.
 * Ship orientation convention:
 *   +Z = toward the player (camera side), -Z = "forward" flight.
 * ---------------------------------------------------------------
 */
import * as THREE from 'three/webgpu';

/** Shared unit geometries (created once, reused across all ships). */
const GEO = {
  hull: new THREE.ConeGeometry(1, 1, 5),
  wing: new THREE.BoxGeometry(1, 1, 1),
  fin: new THREE.ConeGeometry(1, 1, 4),
  core: new THREE.IcosahedronGeometry(1, 0),
  engine: new THREE.CylinderGeometry(1, 1, 1, 8),
  canopy: new THREE.SphereGeometry(1, 8, 6),
  gun: new THREE.BoxGeometry(1, 1, 1),
  ring: new THREE.TorusGeometry(1, 1, 6, 24),
};

/** Thin emissive quad — the "neon strip" detailing language. */
function strip(parent, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 0.03, 0.08]) {
  return add(parent, GEO.gun, mat, pos, rot, scale);
}

export function stdMat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.55,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: true,
  });
}

export function glowMat(color, intensity = 1.6) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: color,
    emissiveIntensity: intensity,
    roughness: 0.3,
    metalness: 0,
    flatShading: true,
  });
}

/** Adds a mesh and returns it for further tweaking. */
function add(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.scale.set(...scale);
  parent.add(m);
  return m;
}

/**
 * The player craft — "sleek delta" interceptor.
 * Silhouette, front to back (forward = -Z, away from camera):
 *   energy-tipped needle nose -> low dark hull + light spine ->
 *   canopy bubble -> canards -> wide swept delta wings with glowing
 *   leading edges and wingtip cannons -> twin vertical tails with
 *   orange accents -> triple engine bay (cowl + glow ring + animated flame).
 * The three flame cores are the only 'engine'-named meshes; Player.js
 * animates their scale/emissive every frame (dash boosts them too).
 */
export function buildPlayerShip() {
  const g = new THREE.Group();
  // Bright "neon" palette — hulls carry a soft emissive tint so the craft
  // reads luminous against the dark starfield instead of flat navy.
  const hull = stdMat(0x3a7fd6, { roughness: 0.45, metalness: 0.5, emissive: 0x1e5aa8, emissiveIntensity: 0.4 });
  const hullLight = stdMat(0x63b1f2, { roughness: 0.38, metalness: 0.45, emissive: 0x2f86d4, emissiveIntensity: 0.45 });
  const white = stdMat(0xe6f7ff, { roughness: 0.3, metalness: 0.3, emissive: 0x9fdcff, emissiveIntensity: 0.3 });
  const trim = stdMat(0x5cf6ff, { emissive: 0x5cf6ff, emissiveIntensity: 1.0 });
  const dark = stdMat(0x1a2c4a, { roughness: 0.7, metalness: 0.35 });
  const engine = glowMat(0x4fd9ff, 2.4);
  const accent = glowMat(0xffb45e, 2.0);
  const canopy = stdMat(0xc4f4ff, { roughness: 0.12, metalness: 0.1, emissive: 0x35d5ff, emissiveIntensity: 0.85 });

  // --- nose: needle spike + energy tip -------------------------
  add(g, GEO.hull, white, [0, 0.14, -1.7], [-Math.PI / 2, 0, 0], [0.15, 1.0, 0.2]);
  add(g, GEO.core, glowMat(0xc8f5ff, 2.8), [0, 0.14, -2.22], [0, 0, 0], [0.07, 0.07, 0.07]);

  // --- fuselage: broad low hull + lighter raised spine ---------
  add(g, GEO.hull, hull, [0, -0.05, -0.8], [-Math.PI / 2, 0, 0], [0.55, 2.3, 0.6]);
  add(g, GEO.hull, hullLight, [0, 0.3, -0.75], [-Math.PI / 2, 0, 0], [0.4, 1.5, 0.45]);
  add(g, GEO.wing, hull, [0, 0, 0.15], [0, 0, 0], [0.7, 0.5, 0.9]);

  // --- canopy bubble + visor glow strip ------------------------
  add(g, GEO.canopy, canopy, [0, 0.44, -0.75], [0, 0, 0], [0.28, 0.15, 0.4]);
  add(g, GEO.gun, trim, [0, 0.47, -1.15], [0, 0, 0], [0.16, 0.04, 0.14]);

  // --- canards (small forward wings) ---------------------------
  add(g, GEO.wing, hullLight, [-0.62, 0.08, -1.1], [0, 0.7, 0], [0.7, 0.05, 0.42]);
  add(g, GEO.wing, hullLight, [0.62, 0.08, -1.1], [0, -0.7, 0], [0.7, 0.05, 0.42]);

  // --- main delta wings ---------------------------------------
  for (const side of [-1, 1]) {
    // wing plate
    add(g, GEO.wing, hull, [side * 1.05, 0.02, 0.15], [0, side * 0.55, side * -0.04], [1.9, 0.1, 0.95]);
    // glowing leading edge
    add(g, GEO.wing, trim, [side * 1.18, 0.09, 0.12], [0, side * 0.55, 0], [1.55, 0.03, 0.1]);
    // wingtip fin (winglet)
    add(g, GEO.fin, white, [side * 1.95, 0.2, 0.55], [0, side * 0.3, side * -0.12], [0.08, 0.5, 0.3]);
    // wingtip cannon forward rail + orange energy dot
    add(g, GEO.gun, dark, [side * 1.95, 0.02, -0.1], [0, 0, 0], [0.12, 0.16, 1.05]);
    add(g, GEO.core, accent, [side * 1.95, 0.02, -0.68], [0, 0, 0], [0.07, 0.07, 0.07]);
    // intake pod hugging the fuselage
    add(g, GEO.wing, hullLight, [side * 0.58, -0.02, 0.1], [0, side * 0.18, 0], [0.34, 0.42, 1.0]);
    // intake glow slit
    add(g, GEO.gun, trim, [side * 0.78, -0.02, -0.25], [0, side * 0.18, 0], [0.05, 0.14, 0.3]);
  }

  // --- belly glow slit -----------------------------------------
  add(g, GEO.gun, trim, [0, -0.34, -0.3], [0, 0, 0], [0.14, 0.03, 1.0]);

  // --- twin vertical tails + orange accents --------------------
  for (const side of [-1, 1]) {
    add(g, GEO.fin, hull, [side * 0.5, 0.45, 0.85], [0.15, 0, side * -0.15], [0.12, 1.05, 0.5]);
    add(g, GEO.fin, accent, [side * 0.64, 0.42, 0.92], [0.15, 0, side * -0.15], [0.06, 0.7, 0.28]);
  }

  // --- rear engine bay -----------------------------------------
  add(g, GEO.wing, dark, [0, 0, 0.95], [0, 0, 0], [1.25, 0.6, 0.4]);
  for (const [ex, ey] of [[-0.42, 0.02], [0.42, 0.02], [0, -0.16]]) {
    // cowl
    add(g, GEO.engine, dark, [ex, ey, 1.15], [Math.PI / 2, 0, 0], [0.26, 0.26, 0.55]);
    // static glow ring at the nozzle exit
    add(g, GEO.engine, engine, [ex, ey, 1.42], [Math.PI / 2, 0, 0], [0.27, 0.29, 0.07]);
    // animated flame core (Picked up by Player._collectEngines)
    const nozzle = add(g, GEO.core, engine, [ex, ey, 1.55], [0, 0, 0], [0.2, 0.2, 0.34]);
    nozzle.name = 'engine';
  }

  return g;
}

/**
 * Builds one of the four enemy archetypes.
 * `palette` = { hull, wing, core, glow }
 */
export function buildEnemyShip(type, palette) {
  const g = new THREE.Group();
  const hullM = stdMat(palette.hull);
  const wingM = stdMat(palette.wing);
  const coreM = glowMat(palette.core, 2.0);
  const darkM = stdMat(0x0a0a14, { roughness: 0.8, metalness: 0.3 });
  const glowM = glowMat(palette.glow, 1.7);
  const canopyM = stdMat(0x9fe8ff, { roughness: 0.15, metalness: 0.1, emissive: palette.glow, emissiveIntensity: 0.35 });

  const core = (name) => {
    const c = add(g, GEO.core, coreM, [0, 0.16, -0.15], [0, 0, 0], [0.3, 0.3, 0.3]);
    c.name = name;
    return c;
  };

  if (type === 'fighter') {
    // "Firefly" — wasp dart: needle beak, twin forward eyes, low hull with
    // a lighter spine, V-swept wings with glowing leading edges, twin tail
    // fins and a dark aft deck that holds the animated engine emitters.
    add(g, GEO.hull, hullM, [0, 0.02, 0.25], [0, 0, 0], [0.5, 1.5, 0.62]);
    add(g, GEO.hull, wingM, [0, 0.3, 0.15], [0, 0, 0], [0.28, 1.15, 0.4]); // dorsal spine
    add(g, GEO.hull, wingM, [0, 0.08, -1.02], [Math.PI / 2, 0, 0], [0.18, 1.15, 0.24]); // beak spike
    add(g, GEO.core, coreM, [0, 0.04, -1.62], [0, 0, 0], [0.055, 0.055, 0.055]); // beak tip
    add(g, GEO.core, coreM, [-0.13, 0.3, -0.55], [0, 0, 0], [0.07, 0.07, 0.07]); // left eye
    add(g, GEO.core, coreM, [0.13, 0.3, -0.55], [0, 0, 0], [0.07, 0.07, 0.07]); // right eye
    // swept wing plates + neon leading edges
    for (const s of [-1, 1]) {
      add(g, GEO.wing, wingM, [s * 0.92, -0.02, 0.5], [0, s * -0.62, 0], [1.5, 0.09, 0.85]);
      add(g, GEO.wing, wingM, [s * 1.6, 0.09, 0.14], [0, s * -0.62, 0], [0.95, 0.04, 0.2]);
      strip(g, glowM, [s * 0.98, 0.04, 0.32], [0, s * -0.62, 0], [1.3, 0.03, 0.07]);
      add(g, GEO.gun, darkM, [0.16 * s, 0.0, -0.72], [0, 0, 0], [0.08, 0.1, 0.5]); // gun rail
    }
    // twin tail fins + dark aft deck (emitters attach in the shared tail block)
    for (const s of [-1, 1]) {
      add(g, GEO.fin, wingM, [s * 0.34, 0.24, 0.82], [0, 0, s * -0.18], [0.08, 0.7, 0.34]);
      add(g, GEO.wing, darkM, [0, 0.04, 1.12], [0, 0, 0], [0.68, 0.26, 0.5]);
    }
    core('core');
  } else if (type === 'interceptor') {
    // "Lancer" — X-wing style: slender fuselage, four angled wing blades
    // around a central hub with neon tips, a dorsal blade and twin long
    // stingers running aft to the engine emitters (shared tail block).
    add(g, GEO.hull, hullM, [0, 0.05, 0.35], [0, 0, 0], [0.4, 1.7, 0.55]);
    add(g, GEO.hull, wingM, [0, 0.26, 0.25], [0, 0, 0], [0.2, 1.3, 0.36]); // spine
    add(g, GEO.hull, wingM, [0, 0.12, -1.0], [Math.PI / 2, 0, 0], [0.14, 1.5, 0.2]); // arrow beak
    add(g, GEO.fin, hullM, [0, 0.3, 0.9], [0.22, 0, 0], [0.1, 1.0, 0.42]); // dorsal blade
    // X of wing blades around the hub
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        add(g, GEO.wing, wingM, [sx * 0.62, 0, sz * 0.42], [0, sx * sz * 0.72, 0], [1.25, 0.08, 0.6]);
        add(g, GEO.fin, wingM, [sx * 1.12, 0.14, sz * 0.72], [sx * sz * 0.72, 0, 0], [0.08, 0.42, 0.22]);
        add(g, GEO.core, glowM, [sx * 1.45, 0.01, sz * 0.95], [0, 0, 0], [0.07, 0.07, 0.07]); // wingtip node
      }
    }
    add(g, GEO.wing, darkM, [0, -0.02, 0.1], [0, 0, 0], [0.95, 0.12, 0.95]); // hub
    strip(g, glowM, [0, 0.09, -0.1], [0, 0, 0], [0.08, 0.03, 1.1]); // spine glow strip
    for (const s of [-1, 1]) {
      add(g, GEO.engine, darkM, [s * 0.22, -0.12, 1.2], [Math.PI / 2, 0, 0], [0.09, 0.09, 1.55]); // stingers
    }
    core('core');
  } else if (type === 'heavy') {
    // "Juggernaut" — layered fortress: stacked hull decks with a raised
    // prow, a glowing command bridge, twin armoured side pods with gun
    // barrels + vents, forward belly cannons and a broad aft deck whose
    // three emitters sit in the shared tail block.
    add(g, GEO.wing, hullM, [0, 0.0, 0.2], [0, 0, 0], [1.95, 0.8, 1.5]); // main deck
    add(g, GEO.wing, hullM, [0, 0.52, 0.1], [0, 0, 0], [1.3, 0.5, 1.3]); // upper deck
    add(g, GEO.wing, wingM, [0, 0.16, -0.72], [0, 0, 0], [1.5, 0.5, 0.55]); // prow
    add(g, GEO.core, glowM, [0, 0.66, -0.98], [0, 0, 0], [0.08, 0.08, 0.08]); // prow light
    add(g, GEO.wing, wingM, [0, 0.9, 0.45], [0, 0, 0], [0.5, 0.35, 0.8]); // bridge block
    add(g, GEO.canopy, canopyM, [0, 0.76, 0.1], [0, 0, 0], [0.24, 0.13, 0.22]); // bridge glass
    // armoured side pods: cheek + barrel + vent
    for (const s of [-1, 1]) {
      add(g, GEO.wing, wingM, [s * 1.28, -0.12, 0.38], [0, 0, s * -0.1], [0.68, 0.95, 1.15]);
      add(g, GEO.engine, darkM, [s * 1.55, -0.06, -0.25], [Math.PI / 2, 0, 0], [0.13, 0.13, 1.1]);
      add(g, GEO.core, glowMat(palette.glow, 2.0), [s * 1.55, -0.06, -0.78], [0, 0, 0], [0.1, 0.1, 0.1]); // muzzle
      add(g, GEO.core, coreM, [s * 1.12, 0.34, 0.7], [0, 0, 0], [0.14, 0.14, 0.14]); // vent
      strip(g, glowM, [s * 1.02, -0.02, 0.55], [0, 0, 0], [0.5, 0.04, 0.06]); // pod trim
    }
    // forward belly cannons + aft thruster deck
    for (const s of [-1, 1]) {
      add(g, GEO.engine, darkM, [s * 0.5, -0.42, 0.95], [Math.PI / 2, 0, 0], [0.11, 0.11, 0.7]);
    }
    add(g, GEO.gun, darkM, [0, -0.24, 1.0], [0, 0, 0], [1.1, 0.55, 0.55]);
    add(g, GEO.wing, darkM, [0, 0.06, 1.05], [0, 0, 0], [1.3, 0.34, 0.6]); // aft deck
    core('core');
  } else if (type === 'elite') {
    // "Oracle" — halo fighter: slim needle hull + glass cockpit, long
    // crescent wings with neon edges and finlets, twin aft pods, a nose
    // emitter, and a slowly rotating energy halo (name 'halo' — Enemy.js
    // spins it as a signature idle animation).
    add(g, GEO.hull, hullM, [0, 0.04, 0.2], [0, 0, 0], [0.42, 1.7, 0.55]);
    add(g, GEO.hull, wingM, [0, 0.26, 0.05], [0, 0, 0], [0.24, 1.25, 0.4]); // spine
    add(g, GEO.hull, wingM, [0, 0.05, -1.32], [Math.PI / 2, 0, 0], [0.16, 0.95, 0.22]); // nose spike
    add(g, GEO.canopy, canopyM, [0, 0.4, -0.6], [0, 0, 0], [0.22, 0.13, 0.3]); // cockpit
    add(g, GEO.gun, darkM, [0, -0.05, -0.95], [0, 0, 0], [0.1, 0.07, 0.5]); // nose gun
    add(g, GEO.core, coreM, [0, -0.05, -1.25], [0, 0, 0], [0.05, 0.05, 0.05]); // nose light
    // crescent wings + neon edges + finlets
    for (const s of [-1, 1]) {
      add(g, GEO.wing, wingM, [s * 0.68, 0.0, 0.08], [0, s * -0.5, 0], [1.55, 0.08, 0.62]);
      add(g, GEO.wing, wingM, [s * 1.28, 0.12, -0.36], [0, s * -0.5, 0], [0.85, 0.04, 0.22]);
      strip(g, glowM, [s * 0.75, 0.06, -0.02], [0, s * -0.5, 0], [1.4, 0.03, 0.07]);
      add(g, GEO.fin, wingM, [s * 1.15, 0.22, 0.3], [0, s * -0.5, s * -0.12], [0.08, 0.6, 0.26]);
      add(g, GEO.core, glowM, [s * 1.72, 0.02, -0.62], [0, 0, 0], [0.06, 0.06, 0.06]); // wingtip
    }
    // twin aft pods (engine emitters attach in the shared tail block)
    for (const s of [-1, 1]) add(g, GEO.engine, darkM, [s * 0.3, -0.05, 0.85], [Math.PI / 2, 0, 0], [0.16, 0.16, 0.7]);
    // rotating energy halo
    const halo = new THREE.Mesh(GEO.ring, glowMat(palette.glow, 2.2));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.12, 0.2);
    halo.scale.set(1.12, 1.12, 0.13);
    halo.name = 'halo';
    g.add(halo);
    core('core');
  } else if (type === 'boss') {
    // Boss material overrides (shadow the shared hullM/wingM/darkM for this
    // block only): self-illuminated luminous violet so the dreadnought
    // reads bold against the dark nebula instead of near-black.
    const hullM = stdMat(palette.hull, { roughness: 0.42, metalness: 0.32, emissive: 0x301a5c, emissiveIntensity: 0.8 });
    const wingM = stdMat(palette.wing, { roughness: 0.38, metalness: 0.3, emissive: 0x45277e, emissiveIntensity: 0.85 });
    const darkM = stdMat(0x2c1d44, { roughness: 0.65, metalness: 0.35, emissive: 0x180e2e, emissiveIntensity: 0.5 });
    // massive dreadnought: layered hull, five gun pods, armoured face,
    // glowing trim, dorsal spires, red stern vents, wingtip pods.
    // +Z faces the player; cannons keep their original x/z so the
    // muzzle fire in Boss.js lines up with the visible barrels.
    add(g, GEO.wing, hullM, [0, 0, 0], [0, 0, 0], [3.4, 1.5, 3.2]);
    add(g, GEO.wing, wingM, [0, 0.9, 0], [0, 0, 0], [2.3, 0.7, 3.3]);
    add(g, GEO.wing, hullM, [0, -0.4, -1.2], [0, 0, 0], [4.4, 1.0, 1.6]);
    add(g, GEO.hull, wingM, [0, 1.1, 0.6], [Math.PI / 2, 0, 0], [1.0, 1.6, 1.0]);
    // side armour cheeks between hull and outer guns
    add(g, GEO.wing, hullM, [-1.7, -0.2, 1.1], [0, 0, 0], [1.1, 0.8, 1.3]);
    add(g, GEO.wing, hullM, [1.7, -0.2, 1.1], [0, 0, 0], [1.1, 0.8, 1.3]);
    // V-shaped prow plates flanking the center barrel
    add(g, GEO.wing, wingM, [-0.62, -0.05, 1.95], [0, 0.38, 0], [0.72, 0.95, 0.2]);
    add(g, GEO.wing, wingM, [0.62, -0.05, 1.95], [0, -0.38, 0], [0.72, 0.95, 0.2]);
    // lower jaw plate
    add(g, GEO.wing, hullM, [0, -0.78, 1.35], [0, 0, 0], [2.2, 0.42, 0.6]);
    // glowing trim strips along the flanks
    add(g, GEO.gun, glowMat(palette.glow, 1.5), [-1.85, 0.52, 0], [0, 0, 0], [0.07, 0.09, 2.9]);
    add(g, GEO.gun, glowMat(palette.glow, 1.5), [1.85, 0.52, 0], [0, 0, 0], [0.07, 0.09, 2.9]);
    // wing blades + glowing tip pods
    add(g, GEO.fin, wingM, [-2.9, 0.4, 0.2], [0, 0.4, -0.5], [0.5, 2.6, 0.3]);
    add(g, GEO.fin, wingM, [2.9, 0.4, 0.2], [0, -0.4, 0.5], [0.5, 2.6, 0.3]);
    add(g, GEO.core, glowMat(palette.glow, 2.0), [-3.3, 0.45, 0.05], [0, 0, 0], [0.26, 0.26, 0.26]);
    add(g, GEO.core, glowMat(palette.glow, 2.0), [3.3, 0.45, 0.05], [0, 0, 0], [0.26, 0.26, 0.26]);
    // dorsal spire crown
    add(g, GEO.fin, wingM, [0, 1.55, 0.9], [0.1, 0, 0], [0.14, 0.7, 0.5]);
    add(g, GEO.fin, wingM, [0, 1.62, -0.2], [0.1, 0, 0], [0.16, 0.85, 0.5]);
    add(g, GEO.fin, wingM, [0, 1.55, -1.2], [0.1, 0, 0], [0.14, 0.7, 0.5]);
    // red stern reactor vents (rear = -Z)
    add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [-1.2, -0.5, -1.75], [0, 0, 0], [0.7, 0.5, 0.35]);
    add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [1.2, -0.5, -1.75], [0, 0, 0], [0.7, 0.5, 0.35]);
    // gun pods (name them so projectiles can be traced back to the boss)
    for (const [x, z] of [[-2.1, 1.1], [2.1, 1.1], [0, 1.6], [-1.3, 1.5], [1.3, 1.5]]) {
      const pod = add(g, GEO.engine, darkM, [x, -0.35, z], [Math.PI / 2, 0, 0], [0.45, 0.45, 0.8]);
      pod.name = 'cannon';
      add(g, GEO.core, glowMat(palette.glow, 2.2), [x, -0.35, z + 0.5], [0, 0, 0], [0.22, 0.22, 0.22]);
    }
    // big central core
    const bigCore = add(g, GEO.core, glowMat(palette.core, 2.4), [0, 0.55, 1.1], [0, 0, 0], [0.9, 0.9, 0.9]);
    bigCore.name = 'core';
    // flank crown spikes + ram horns
    for (const s of [-1, 1]) {
      add(g, GEO.fin, wingM, [s * 0.55, 1.32, 0.4], [0, 0, s * -0.5], [0.1, 0.5, 0.34]);
      add(g, GEO.fin, darkM, [s * 0.55, 0, 2.55], [Math.PI / 2, 0, 0], [0.13, 0.13, 1.1]);
      add(g, GEO.core, glowMat(palette.glow, 2.2), [s * 0.55, 0, 3.12], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // --- upgraded armour ring -------------------------------------
    // shoulder armour pylons + glowing edge trim (visual, non-firing)
    for (const s of [-1, 1]) {
      add(g, GEO.wing, hullM, [s * 2.15, 0.95, 0.55], [0, s * -0.22, 0], [1.05, 0.5, 1.25]);
      add(g, GEO.wing, darkM, [s * 2.75, 0.7, 0.95], [0, s * -0.3, 0], [0.5, 0.62, 0.72]);
      strip(g, glowM, [s * 1.78, 1.08, 1.18], [0, s * -0.22, 0], [0.9, 0.05, 0.07]);
      // cheek gun barrels (decor — keep them OFF the 'cannon' name so the
      // Boss.js charge/ci mapping stays on the five real firing pods)
      add(g, GEO.engine, darkM, [s * 1.95, -0.78, 1.7], [Math.PI / 2, 0, 0], [0.13, 0.13, 0.95]);
      add(g, GEO.core, glowMat(palette.glow, 2.0), [s * 1.95, -0.78, 2.18], [0, 0, 0], [0.09, 0.09, 0.09]);
    }
    // outer wing layer: longer secondary blades + outer glow pods
    for (const s of [-1, 1]) {
      add(g, GEO.fin, hullM, [s * 3.85, 0.7, 0.05], [0, s * 0.5, -s * 0.6], [0.42, 2.3, 0.26]);
      add(g, GEO.wing, darkM, [s * 3.5, 0.1, 0.4], [0, s * 0.45, 0], [0.38, 0.34, 0.95]);
      add(g, GEO.core, glowMat(palette.glow, 2.2), [s * 4.28, 1.12, -0.15], [0, 0, 0], [0.18, 0.18, 0.18]);
    }
    // red prow "eyes" embedded in the V plates — the boss stares back
    for (const s of [-1, 1]) {
      add(g, GEO.core, glowMat(0xff3b5c, 2.6), [s * 0.62, 0.12, 2.08], [0, 0, 0], [0.1, 0.1, 0.1]);
    }
    // dorsal spire crown: red energy caps on each spire tip
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 1.92, 0.9], [0, 0, 0], [0.08, 0.08, 0.08]);
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 2.08, -0.2], [0, 0, 0], [0.09, 0.09, 0.09]);
    add(g, GEO.core, glowMat(0xff3b5c, 2.2), [0, 1.92, -1.2], [0, 0, 0], [0.08, 0.08, 0.08]);
    // pulsing stern reactor (name 'vent' — Boss.js breathes it)
    const vent = add(g, GEO.wing, glowMat(0xff3b5c, 1.7), [0, -0.55, -1.85], [0, 0, 0], [1.0, 0.7, 0.4]);
    vent.name = 'vent';
  }

  // engine glow on the aft (rear = +Z for enemies facing player). The
  // per-type emitters are the flames: Enemy.js finds them via name 'engine'
  // and pulses their scale + emissive every frame.
  const engines = [];
  if (type !== 'boss') {
    const emitters = {
      fighter: [[-0.26, 0.05, 1.42], [0.26, 0.05, 1.42], [0, 0.12, 1.5]],
      interceptor: [[-0.22, -0.12, 1.78], [0.22, -0.12, 1.78]],
      heavy: [[-0.45, 0.2, 1.28], [0, 0.2, 1.34], [0.45, 0.2, 1.28]],
      elite: [[-0.3, -0.02, 1.05], [0.3, -0.02, 1.05]],
    }[type];
    if (emitters) {
      for (const [ex, ey, ez] of emitters) {
        const eng = add(g, GEO.core, glowMat(palette.glow, 1.6), [ex, ey, ez], [0, 0, 0], [0.16, 0.16, 0.26]);
        eng.name = 'engine';
        eng.userData.baseScale = [0.16, 0.16, 0.26]; // _engineGlow pulses against this
        engines.push(eng);
      }
    }
  }
  g.userData.engines = engines;
  return g;
}
