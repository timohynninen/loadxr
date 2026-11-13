import * as THREE from 'three';
import {cargoColor, cargoInk} from './cargo-colors.js';

function texture(canvas) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

function canvasPlane(width, height, canvas) {
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({map: texture(canvas), transparent: true, depthTest: false, depthWrite: false, toneMapped: false}));
}

function label(text, width = 1.4, height = .5, color = '#3c555c', background = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 100;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 320, 100); }
  ctx.fillStyle = color; ctx.font = 'bold 58px Arial'; ctx.textAlign = 'center';
  ctx.textBaseline = 'middle'; ctx.fillText(text, 160, 52);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: texture(canvas), depthTest: false, depthWrite: false, toneMapped: false}));
  sprite.scale.set(width, height, 1);
  return sprite;
}

// Model coordinates match the web guide: x from the front, y from the left,
// and z upwards, all supplied in millimetres. Three.js geometry uses metres.
function buildPlan(shipment, renderOrder = 0) {
  const root = new THREE.Group(), cargo = new Map();
  const L = shipment.trailer.length / 1000, W = shipment.trailer.width / 1000;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(L, .06, W),
    new THREE.MeshBasicMaterial({color: '#d5dfce'}));
  floor.position.y = -.04; root.add(floor);
  const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(L, shipment.trailer.height / 1000, W)),
    new THREE.LineBasicMaterial({color: '#9aafa4', transparent: true, opacity: .5}));
  frame.position.y = shipment.trailer.height / 2000; root.add(frame);
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
    const number = label(String(item.number).padStart(2, '0'), .85, .45, cargoInk(item), cargoColor(item));
    number.position.copy(body.position); number.position.y += h / 2 + .4; root.add(number);
    cargo.set(item.id, {body, edge, number});
  }
  for (const [text, x] of [['FRONT', -L / 2 - .8], ['REAR', L / 2 + .8]]) {
    const marker = label(text, 1.5, .42); marker.position.set(x, .1, 0); root.add(marker);
  }
  root.traverse(object => object.renderOrder = renderOrder);
  return {root, cargo};
}

function highlight(plan, id) {
  for (const [key, {body, edge, number}] of plan.cargo) {
    const active = key === id;
    body.material.opacity = active ? 1 : .085;
    body.material.depthWrite = active;
    edge.material.opacity = active ? 1 : .18;
    number.visible = active;
  }
}

function wrapped(ctx, text, x, y, width, lineHeight, maxLines = 2) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > width && line) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((line, i) => {
    if (i === maxLines - 1 && lines.length > maxLines) {
      while (ctx.measureText(`${line}…`).width > width) line = line.slice(0, -1);
      line += '…';
    }
    ctx.fillText(line, x, y + i * lineHeight);
  });
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
    this.panelCanvas.width = 900; this.panelCanvas.height = 1000;
    // About 24 degrees wide; its left edge stays to the right of straight ahead.
    this.backplate = canvasPlane(.81, .90, this.panelCanvas);
    this.backplate.renderOrder = 10; this.panel.add(this.backplate);
    this.miniature = buildPlan(shipment, 11);
    this.miniature.root.scale.setScalar(.033);
    this.miniature.root.rotation.set(.78, -.25, -.10);
    this.miniature.root.position.set(-.04, .225, .025);
    this.panel.add(this.miniature.root);
    this.buttons = [-1, 1].map((delta, i) => {
      const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 120;
      const button = canvasPlane(.345, .098, canvas);
      button.position.set(i === 0 ? -.193 : .193, -.36, .018);
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
    // Fit the whole miniature at every phone/desktop aspect ratio.
    const distance = Math.max(17, 13 / this.camera.aspect);
    this.camera.position.set(distance * .34, distance * .64, distance * .67);
    this.camera.lookAt(0, 1, 0);
    this.dirty = true;
  }

  update(step) {
    highlight(this.preview, step.item.id); highlight(this.miniature, step.item.id);
    this.step = step;
    const ctx = this.panelCanvas.getContext('2d');
    ctx.clearRect(0, 0, 900, 1000);
    ctx.fillStyle = '#f2f4ed'; ctx.beginPath(); ctx.roundRect(0, 0, 900, 1000, 32); ctx.fill();
    ctx.fillStyle = '#4a6267'; ctx.font = 'bold 29px Arial';
    ctx.fillText(step.stage.title, 46, 54);
    ctx.textAlign = 'right'; ctx.fillText(`${step.index + 1} / ${step.total}`, 854, 54); ctx.textAlign = 'left';
    ctx.fillStyle = '#53676a'; ctx.font = 'bold 19px Arial'; ctx.textAlign = 'center';
    ctx.fillText('POSITION IN LOAD PLAN', 450, 322); ctx.textAlign = 'left';
    ctx.fillStyle = '#d5ded1'; ctx.fillRect(35, 346, 830, 2);
    ctx.fillStyle = cargoColor(step.item); ctx.beginPath(); ctx.roundRect(46, 375, 95, 95, 20); ctx.fill();
    ctx.fillStyle = cargoInk(step.item); ctx.font = 'bold 47px Arial'; ctx.textAlign = 'center';
    ctx.fillText(String(step.item.number).padStart(2, '0'), 94, 438); ctx.textAlign = 'left';
    ctx.fillStyle = '#172b30'; ctx.font = 'bold 42px Arial'; ctx.fillText(step.item.label, 165, 410);
    ctx.font = '27px Arial'; wrapped(ctx, step.item.name, 165, 450, 685, 34, 2);
    ctx.font = 'bold 31px Arial'; ctx.fillText(step.location, 46, 538);
    ctx.font = 'bold 35px Arial'; ctx.fillText(`${step.item.weight} kg`, 46, 593);
    ctx.font = '28px Arial'; ctx.fillText(`${step.item.pallets} EUR ${step.item.pallets === 1 ? 'pallet' : 'pallets'}`, 300, 593);
    ctx.fillText(`${step.item.length} × ${step.item.width} × ${step.item.height} mm`, 46, 640);
    ctx.fillStyle = '#425c61'; ctx.font = '26px Arial';
    wrapped(ctx, `Upright · no rotation${step.item.note ? ' · ' + step.item.note : ''}`, 46, 690, 808, 33, 2);
    if (step.stack) wrapped(ctx, step.stack, 46, 775, 808, 33, 2);
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
      this.panel.position.set(.70, .36, -1.8).applyQuaternion(this.headQuaternion).add(this.headPosition);
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
