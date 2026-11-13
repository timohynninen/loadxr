import * as THREE from 'three';
import {cargoColor} from './cargo-colors.js';
import {conciseDetails} from './xr-sequence.js?v=2';

function texture(canvas) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function canvasPlane(width, height, canvas) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({map: texture(canvas), transparent: true, depthTest: false, depthWrite: false, toneMapped: false}));
}

// Model coordinates match the web guide: x from the front, y from the left,
// and z upwards, all supplied in millimetres. Three.js geometry uses metres.
function buildPlan(shipment, renderOrder = 0) {
  const root = new THREE.Group(), cargo = new Map();
  const L = shipment.trailer.length / 1000, W = shipment.trailer.width / 1000;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, .06, W),
    new THREE.MeshBasicMaterial({color: '#d5dfce'}));
  floor.position.y = -.04; root.add(floor);
  for (const item of shipment.items) {
    const p = shipment.placements.find(p => p.id === item.id);
    const l = item.length / 1000, w = item.width / 1000, h = item.height / 1000;
    const body = new THREE.Mesh(new THREE.BoxGeometry(l - .02, h - .01, w - .02),
      new THREE.MeshBasicMaterial({color: cargoColor(item), transparent: true}));
    body.position.set((p.x + item.length / 2) / 1000 - L / 2,
      (p.z + item.height / 2) / 1000, W / 2 - (p.y + item.width / 2) / 1000);
    root.add(body);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({color: '#1b3039', transparent: true}));
    edge.position.copy(body.position); root.add(edge);
    cargo.set(item.id, {body, edge});
  }
  root.traverse(object => object.renderOrder = renderOrder);
  return {root, cargo, floor, L, W};
}

function focusItem(plan, step) {
  const bounds = new THREE.Box3();
  for (const [key, {body, edge}] of plan.cargo) {
    const active = key === step.item.id, support = key === step.item.placement.base;
    body.visible = edge.visible = active || support;
    body.material.opacity = active ? 1 : .12;
    body.material.depthWrite = active;
    edge.material.opacity = active ? 1 : .25;
    if (body.visible) {
      body.geometry.computeBoundingBox();
      bounds.union(body.geometry.boundingBox.clone().translate(body.position));
    }
  }
  const size = bounds.getSize(new THREE.Vector3()), centre = bounds.getCenter(new THREE.Vector3());
  plan.floor.scale.set(size.x / plan.L, 1, size.z / plan.W);
  plan.floor.position.set(centre.x, bounds.min.y - .04, centre.z);
  bounds.min.y -= .08;
  return bounds;
}

function textLine(ctx, text, x, y, width) {
  let line = text;
  if (ctx.measureText(line).width > width) {
    while (line && ctx.measureText(`${line}…`).width > width) line = line.slice(0, -1);
    line += '…';
  }
  ctx.fillText(line, x, y);
}

export class GlanceScene {
  constructor(container, shipment, onMove, onSessionChange, onError) {
    this.container = container; this.onMove = onMove; this.onSessionChange = onSessionChange;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, powerPreference: 'low-power'});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); onError('The 3D view stopped. Reload this page to restore it.');
      this.renderer.xr.getSession()?.end().catch(() => {});
    });
    container.replaceChildren(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
    this.preview = buildPlan(shipment); this.scene.add(this.preview.root);
    this.panel = new THREE.Group(); this.panel.visible = false; this.scene.add(this.panel);
    this.panelCanvas = document.createElement('canvas');
    this.panelCanvas.width = 900; this.panelCanvas.height = 690;
    // Compact upper-right glance panel; the centre of the view stays clear.
    this.backplate = canvasPlane(.60, .46, this.panelCanvas);
    this.backplate.renderOrder = 10; this.panel.add(this.backplate);
    this.miniature = buildPlan(shipment, 11);
    this.panel.add(this.miniature.root);
    this.buttons = [-1, 1].map((delta, i) => {
      const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 120;
      const button = canvasPlane(.263, .087, canvas);
      button.position.set(i === 0 ? -.142 : .142, -.172, .018);
      button.renderOrder = 12; button.userData.delta = delta; button.userData.canvas = canvas;
      this.panel.add(button); return button;
    });
    this.raycaster = new THREE.Raycaster();
    this.headPosition = new THREE.Vector3(); this.headQuaternion = new THREE.Quaternion();
    this.headScale = new THREE.Vector3();
    this.controllers = [0, 1].map(index => {
      const controller = this.renderer.xr.getController(index);
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({color: '#d8f6b0', transparent: true, opacity: .7, depthTest: false}));
      ray.scale.z = 3; ray.renderOrder = 20; controller.add(ray);
      controller.userData.connected = false;
      controller.addEventListener('connected', () => controller.userData.connected = true);
      controller.addEventListener('disconnected', () => controller.userData.connected = false);
      controller.addEventListener('select', () => {
        const hit = this.controllerHit(controller);
        if (hit?.object.userData.enabled) this.onMove(hit.object.userData.delta);
      });
      this.scene.add(controller); return controller;
    });
    this.renderer.xr.addEventListener('sessionstart', () => {
      this.preview.root.visible = false; this.panel.visible = true;
      this.camera.position.set(0, 0, 0); this.camera.quaternion.identity();
      this.onSessionChange(true);
    });
    this.renderer.xr.addEventListener('sessionend', () => {
      this.preview.root.visible = true; this.panel.visible = false;
      for (const controller of this.controllers) controller.visible = false;
      this.resize(); this.onSessionChange(false);
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container); this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  resize() {
    if (this.renderer.xr.isPresenting) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.fitCurrentItem();
    this.dirty = true;
  }

  fitCurrentItem() {
    if (!this.focusBounds || this.renderer.xr.isPresenting) return;
    const bounds = this.focusBounds, centre = bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(.9, .65, 1.15).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    let distance = .1;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).sub(centre), depth = point.dot(direction);
      distance = Math.max(distance, depth + Math.abs(point.dot(right)) / (tan * this.camera.aspect * .85), depth + Math.abs(point.dot(up)) / (tan * .80));
    }
    this.camera.position.copy(centre).addScaledVector(direction, distance * 1.04);
    this.camera.lookAt(centre);
  }

  update(step) {
    this.focusBounds = focusItem(this.preview, step);
    const bounds = focusItem(this.miniature, step);
    // Fit the rotated current item into the model region of the headset panel.
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.48, -.62, -.08));
    const rotated = bounds.clone().applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rotation));
    const size = rotated.getSize(new THREE.Vector3()), centre = rotated.getCenter(new THREE.Vector3());
    const scale = Math.min(.40 / size.x, .205 / size.y, .23 / size.z);
    this.miniature.root.quaternion.copy(rotation); this.miniature.root.scale.setScalar(scale);
    this.miniature.root.position.copy(centre).multiplyScalar(-scale).add(new THREE.Vector3(-.045, .080, .04));
    this.step = step;
    this.fitCurrentItem();
    const summary = conciseDetails(step);
    const ctx = this.panelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 900, 690);
    ctx.fillStyle = '#f2f4ed'; ctx.beginPath(); ctx.roundRect(0, 0, 900, 690, 28); ctx.fill();
    ctx.fillStyle = '#506366'; ctx.font = '27px Arial'; ctx.textAlign = 'right';
    ctx.fillText(`${step.index + 1} / ${step.total}`, 854, 46); ctx.textAlign = 'left';
    ctx.fillStyle = cargoColor(step.item); ctx.fillRect(32, 390, 6, 108);
    ctx.fillStyle = '#172b30'; ctx.font = 'bold 35px Arial'; textLine(ctx, summary.title, 53, 432, 795);
    ctx.fillStyle = '#405a60'; ctx.font = '31px Arial'; textLine(ctx, summary.detail, 53, 480, 795);
    this.backplate.material.map.needsUpdate = true;
    this.buttons.forEach((button, i) => {
      const enabled = i === 0 ? step.index > 0 : step.index < step.total - 1;
      button.userData.enabled = enabled;
      const canvas = button.userData.canvas, ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 420, 120);
      ctx.fillStyle = enabled ? '#203b42' : '#d9e0d5';
      ctx.beginPath(); ctx.roundRect(0, 0, 420, 120, 20); ctx.fill();
      ctx.fillStyle = enabled ? '#ffffff' : '#637477'; ctx.font = 'bold 39px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(i === 0 ? '← Previous' : 'Next →', 210, 62);
      button.material.map.needsUpdate = true;
    });
    this.dirty = true;
  }

  controllerHit(controller) {
    if (!this.renderer.xr.isPresenting || !controller.userData.connected) return null;
    const matrix = new THREE.Matrix4().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(matrix);
    return this.raycaster.intersectObjects(this.buttons)[0] || null;
  }

  render() {
    if (this.renderer.xr.isPresenting) {
      this.renderer.xr.updateCamera(this.camera);
      const head = this.renderer.xr.getCamera();
      head.matrixWorld.decompose(this.headPosition, this.headQuaternion, this.headScale);
      this.panel.position.set(.70, .45, -1.8).applyQuaternion(this.headQuaternion).add(this.headPosition);
      this.panel.quaternion.copy(this.headQuaternion);
      this.panel.updateMatrixWorld(true);
      for (const controller of this.controllers) {
        controller.visible = controller.userData.connected;
        const hit = this.controllerHit(controller);
        controller.children[0].scale.z = hit ? hit.distance : 2;
        controller.children[0].material.color.set(hit?.object.userData.enabled ? '#8cd559' : '#d8f6b0');
      }
      this.renderer.render(this.scene, this.camera);
    } else if (this.dirty && !document.hidden) {
      this.renderer.render(this.scene, this.camera); this.dirty = false;
    }
  }

  async enter() {
    // Call directly from the button gesture. No floor, room scan, anchors or camera-pixel access.
    const session = await navigator.xr.requestSession('immersive-ar', {optionalFeatures: ['hand-tracking']});
    try { await this.renderer.xr.setSession(session); }
    catch (error) { await session.end().catch(() => {}); throw error; }
  }

  async exit() { await this.renderer.xr.getSession()?.end(); }
}
