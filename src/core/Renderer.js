/**
 * Renderer.js
 * ---------------------------------------------------------------
 * Thin wrapper around Three.js WebGPURenderer.
 * - Feature-detects WebGPU support up front.
 * - Async init (renderer.init() is async in three's WebGPU build).
 * - Owns scene, camera, lights, fog, background.
 * - Handles resize.
 * ---------------------------------------------------------------
 */
// three/webgpu — required for THREE.WebGPURenderer (see Renderer.init)
import * as THREE from 'three/webgpu';
import { CAMERA, COLORS } from '../config.js';

export function isWebGPUSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export class Renderer {
  constructor(canvasHost) {
    this._host = canvasHost;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this._baseCamPos = new THREE.Vector3().fromArray([CAMERA.POS.x, CAMERA.POS.y, CAMERA.POS.z]);
    this._baseCamLook = new THREE.Vector3().fromArray([CAMERA.LOOK.x, CAMERA.LOOK.y, CAMERA.LOOK.z]);
  }

  async init() {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(COLORS.BG, 1);

    const canvas = this.renderer.domElement;
    this._host.appendChild(canvas);

    await this.renderer.init();

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(COLORS.BG, 0.0055);

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA.NEAR,
      CAMERA.FAR
    );
    this.camera.position.copy(this._baseCamPos);
    this.camera.lookAt(this._baseCamLook);

    this._setupLights();
    return this;
  }

  _setupLights() {
    const scene = this.scene;

    const ambient = new THREE.AmbientLight(0x2a3560, 0.9);
    scene.add(ambient);

    const key = new THREE.DirectionalLight(0x7fa8ff, 1.6);
    key.position.set(6, 18, 10);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xb060ff, 0.8);
    rim.position.set(-10, 6, -14);
    scene.add(rim);

    // subtle cool fill from below to lift dark hulls
    const fill = new THREE.HemisphereLight(0x1a2a55, 0x05030a, 0.6);
    scene.add(fill);
  }

  resize() {
    // A resize event can fire while init() is still awaiting (mobile
    // viewports adjust on load) — camera/scene don't exist until then.
    if (!this.renderer || !this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
  }

  /** Restore base camera framing (called each frame before custom cam FX). */
  cameraBase() {
    return { pos: this._baseCamPos, look: this._baseCamLook };
  }

  dispose() {
    this.renderer?.dispose();
    this._host.replaceChildren();
  }
}
