import {createSequence, conciseDetails} from './xr-sequence.js?v=2';
import {GlanceScene} from './xr-scene.js?v=2';
import {cargoColor} from './cargo-colors.js';

const $ = id => document.getElementById(id);
let sequence, scene, supported = false, starting = false, cameraStream = null;
const status = message => $('xr-status').textContent = message;

function stopCamera() {
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null;
  $('camera-feed').srcObject = null; $('camera-feed').hidden = true;
  document.body.classList.remove('camera-preview');
}

async function startCamera() {
  starting = true; $('enter-xr').disabled = true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode: {ideal: 'environment'}, width: {ideal: 1280}, height: {ideal: 720}}, audio: false
    });
    const video = $('camera-feed');
    video.srcObject = cameraStream; video.hidden = false;
    await video.play();
    if (document.hidden) { stopCamera(); await checkSupport(); return; }
    document.body.classList.add('camera-preview');
    $('enter-xr').textContent = 'Stop camera';
    status('Camera preview · panel stays on screen, without spatial tracking.');
    for (const track of cameraStream.getVideoTracks()) track.addEventListener('ended', () => {
      stopCamera(); checkSupport();
    });
  } catch (error) {
    stopCamera();
    $('enter-xr').textContent = 'Start camera preview';
    status(error.name === 'NotAllowedError'
      ? 'Camera access was not allowed. Allow the camera in browser settings and retry; the item sequence still works.'
      : 'The camera could not start. Check that it is available, then retry. The item sequence still works.');
  } finally { starting = false; $('enter-xr').disabled = false; }
}

function update() {
  const step = sequence.current(), item = step.item;
  const summary = conciseDetails(step);
  $('counter').textContent = `${step.index + 1} / ${step.total}`;
  $('item-label').textContent = summary.title; $('item-label').title = summary.title;
  $('item-detail').textContent = summary.detail; $('item-detail').title = summary.detail;
  $('item-information').style.borderLeftColor = cargoColor(item);
  $('previous').disabled = step.index === 0;
  $('next').disabled = step.index === step.total - 1;
  $('scene').setAttribute('aria-label', `Close-up: ${item.label}, ${step.location}`);
  scene?.update(step);
}

function move(delta) { sequence.move(delta); update(); }
$('previous').addEventListener('click', () => move(-1));
$('next').addEventListener('click', () => move(1));

function sessionChanged(active) {
  document.body.classList.toggle('in-xr', active);
  $('enter-xr').textContent = active ? 'Leave mixed reality' : 'Enter mixed reality';
  $('enter-xr').disabled = false;
  status(active ? 'Use your controller to select Previous or Next on the panel. Exit using the headset menu.'
    : 'Screen preview · in the headset, the panel sits upper right.');
}

async function checkSupport() {
  if (!window.isSecureContext) {
    $('enter-xr').textContent = 'Camera / MR needs HTTPS';
    status('Use the HTTPS site for camera preview on your phone or mixed reality in your headset.'); return;
  }
  if (navigator.xr) {
    try { supported = await navigator.xr.isSessionSupported('immersive-ar'); }
    catch { supported = false; }
  }
  const cameraAvailable = !!navigator.mediaDevices?.getUserMedia;
  $('enter-xr').disabled = supported ? !scene : !cameraAvailable;
  $('enter-xr').textContent = supported ? 'Enter mixed reality' : cameraAvailable ? 'Start camera preview' : 'Screen preview';
  status(supported ? 'Ready for mixed reality · the panel sits upper right.'
    : cameraAvailable ? 'Start the camera to preview the instructions over your surroundings.'
    : 'Screen preview · camera access is unavailable in this browser.');
}

$('enter-xr').addEventListener('click', async () => {
  if (starting) return;
  if (!supported) {
    if (cameraStream) { stopCamera(); await checkSupport(); }
    else if (navigator.mediaDevices?.getUserMedia) await startCamera();
    return;
  }
  if (!scene) return;
  if (scene.renderer.xr.isPresenting) {
    try { await scene.exit(); } catch { status('Use the headset menu to leave mixed reality.'); }
    return;
  }
  starting = true; $('enter-xr').disabled = true;
  stopCamera();
  try { await scene.enter(); }
  catch (error) {
    document.body.classList.remove('in-xr');
    status(error.name === 'NotAllowedError' || error.name === 'SecurityError'
      ? 'Mixed reality was not allowed. You can retry or keep using the screen preview.'
      : 'Mixed reality could not start. You can retry or use the screen preview.');
    $('enter-xr').textContent = 'Enter mixed reality';
  } finally { starting = false; $('enter-xr').disabled = false; }
});

window.addEventListener('pagehide', stopCamera);
window.addEventListener('pageshow', () => {
  if (sequence && !cameraStream && !scene?.renderer.xr.isPresenting) checkSupport();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && cameraStream) { stopCamera(); checkSupport(); }
});

try {
  const response = await fetch('./example.json');
  if (!response.ok) throw new Error('The example shipment could not be loaded.');
  const shipment = await response.json();
  sequence = createSequence(shipment);
  try {
    scene = new GlanceScene($('scene'), shipment, move, sessionChanged, message => {
      status(message); $('enter-xr').disabled = true;
    });
  } catch {
    $('scene').replaceChildren(document.createTextNode('3D is unavailable in this browser. Item instructions are available below.'));
  }
  update(); await checkSupport();
  if (!scene) status('3D is unavailable in this browser. You can still follow the item sequence below.');
} catch (error) {
  status(error.message || 'The load guide could not start. Reload to try again.');
  $('item-label').textContent = 'Load unavailable';
  $('enter-xr').textContent = 'Mixed reality unavailable';
}

// Uses LoadXR's own asset cache, without storing loading progress.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
