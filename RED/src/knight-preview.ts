import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import './knight-preview.css';

type ModelId = 'patch' | 'original' | 'redesigned';
type DisplayMode = 'compare' | ModelId;
type ViewName = 'front' | 'side' | 'rear' | 'detail';

const canvas = document.querySelector<HTMLCanvasElement>('#knight-canvas');
const studioPanel = document.querySelector<HTMLElement>('.studio-panel');
const status = document.querySelector<HTMLElement>('#model-status');
const stats = document.querySelector<HTMLElement>('#model-stats');
const caption = document.querySelector<HTMLElement>('#view-caption');
const skeletonToggle = document.querySelector<HTMLButtonElement>('#skeleton-toggle');
const boneHierarchy = document.querySelector<HTMLElement>('#bone-hierarchy');
const animationPicker = document.querySelector<HTMLSelectElement>('#animation-clip');
const animationPlay = document.querySelector<HTMLButtonElement>('#animation-play');
const animationStatus = document.querySelector<HTMLElement>('#animation-status');
if (!canvas || !status || !stats || !caption || !skeletonToggle || !boneHierarchy
  || !animationPicker || !animationPlay || !animationStatus) {
  throw new Error('Knight comparison page is missing required elements.');
}
const modelStatus = status;
const viewCaption = caption;
const skeletonButton = skeletonToggle;
const hierarchy = boneHierarchy;
const patchAnimationPicker = animationPicker;
const patchAnimationPlay = animationPlay;
const patchAnimationStatus = animationStatus;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24282a);
scene.fog = new THREE.Fog(0x24282a, 18, 30);
const environmentGenerator = new THREE.PMREMGenerator(renderer);
const studioEnvironment = environmentGenerator.fromScene(new RoomEnvironment(), 0.04);
scene.environment = studioEnvironment.texture;
scene.environmentIntensity = 0.85;
environmentGenerator.dispose();

const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 80);
camera.position.set(0, 1.12, 7.6);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.minDistance = 1.4;
controls.maxDistance = 12;
controls.target.set(0, 0.96, 0);

scene.add(new THREE.HemisphereLight(0xe4edf2, 0x6a6258, 1.65));
scene.add(new THREE.AmbientLight(0xffffff, 0.38));
const key = new THREE.DirectionalLight(0xfff4e3, 3.8);
key.position.set(-3.8, 5.5, 4.8);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.radius = 4;
key.shadow.intensity = 0.28;
key.shadow.camera.left = -3.4;
key.shadow.camera.right = 3.4;
key.shadow.camera.top = 4.2;
key.shadow.camera.bottom = -0.5;
key.shadow.camera.near = 0.1;
key.shadow.camera.far = 20;
key.shadow.bias = -0.00015;
key.shadow.normalBias = 0.025;
scene.add(key);
const fill = new THREE.DirectionalLight(0xdce7ee, 2.0);
fill.position.set(4.5, 3.2, 1.5);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xc5d5e0, 2.7);
rim.position.set(-1.5, 3.8, -4.5);
scene.add(rim);

const floor = new THREE.Mesh(
  new THREE.CircleGeometry(5, 96),
  new THREE.MeshStandardMaterial({ color: 0x505456, roughness: 0.88, metalness: 0.03 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);

const stages: Record<ModelId, THREE.Group> = {
  patch: new THREE.Group(),
  original: new THREE.Group(),
  redesigned: new THREE.Group(),
};
stages.patch.name = 'Patch Animated Knight comparison stage';
stages.original.name = 'Original Knight comparison stage';
stages.redesigned.name = 'Redesigned Knight V2 comparison stage';
scene.add(stages.patch, stages.original, stages.redesigned);

const modelRoots: Partial<Record<ModelId, THREE.Object3D>> = {};
let skeletonHelper: THREE.SkeletonHelper | null = null;
let skeletonModelId: ModelId | null = null;
let patchMixer: THREE.AnimationMixer | null = null;
let patchActiveAction: THREE.AnimationAction | null = null;
let patchClips: THREE.AnimationClip[] = [];
let displayMode: DisplayMode = 'compare';
let activeView: ViewName = 'front';
let cameraDestination = new THREE.Vector3(0, 1.12, 7.6);
let targetDestination = new THREE.Vector3(0, 0.96, 0);

const views: Record<ViewName, { label: string; position: THREE.Vector3; target: THREE.Vector3 }> = {
  front: { label: 'FRONT · PATCH, ORIGINAL, AND V2', position: new THREE.Vector3(0, 1.1, 9.2), target: new THREE.Vector3(0, 0.96, 0) },
  side: { label: 'RIGHT PROFILE · ARMOR DEPTH', position: new THREE.Vector3(9.2, 1.1, 0), target: new THREE.Vector3(0, 0.96, 0) },
  rear: { label: 'REAR · CAPE AND BACK ARMOR', position: new THREE.Vector3(0, 1.1, -9.2), target: new THREE.Vector3(0, 0.96, 0) },
  detail: { label: 'DETAIL · HELMET, FUR, AND CUIRASS', position: new THREE.Vector3(3.0, 1.6, 5.2), target: new THREE.Vector3(0, 1.34, 0) },
};

function arrangeModels(): void {
  const view = views[activeView];
  const direction = view.target.clone().sub(view.position).setY(0).normalize();
  const screenRight = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
  const canvasBounds = canvas!.getBoundingClientRect();
  const panelBounds = studioPanel?.getBoundingClientRect();
  const coveredWidth = panelBounds && panelBounds.width < canvasBounds.width * 0.8
    ? THREE.MathUtils.clamp(panelBounds.right - canvasBounds.left, 0, canvasBounds.width)
    : 0;
  const desiredCenterX = (coveredWidth + canvasBounds.width) * 0.5;
  const pixelsPerWorldUnit = canvasBounds.height /
    (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.distanceTo(controls.target));
  const centerOffset = (desiredCenterX - canvasBounds.width * 0.5) / pixelsPerWorldUnit;
  const compareIds: ModelId[] = ['patch', 'original', 'redesigned'];
  const offset = displayMode === 'compare'
    ? Math.min(0.18 * camera.position.distanceTo(controls.target), 1.6)
    : 0;
  for (const [index, id] of compareIds.entries()) {
    const stage = stages[id];
    stage.visible = displayMode === 'compare' || displayMode === id;
    const side = displayMode === 'compare' ? index - (compareIds.length - 1) / 2 : 0;
    stage.position.copy(screenRight).multiplyScalar(centerOffset + side * offset);
  }
  if (skeletonHelper) {
    skeletonHelper.visible = skeletonButton.getAttribute('aria-pressed') === 'true'
      && skeletonModelId === (displayMode === 'compare' ? 'patch' : displayMode);
  }
}

function showView(name: ViewName): void {
  activeView = name;
  const view = views[name];
  cameraDestination = view.position.clone();
  targetDestination = view.target.clone();
  camera.position.copy(cameraDestination);
  controls.target.copy(targetDestination);
  controls.update();
  viewCaption.textContent = view.label;
  arrangeModels();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  });
}

function selectModels(mode: DisplayMode): void {
  displayMode = mode;
  arrangeModels();
  updateSkeletonButtonLabel();
  updateSkeletonHelper();
  document.querySelectorAll<HTMLButtonElement>('[data-models]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.models === mode));
  });
}

function activeSkeletonModel(): ModelId {
  return displayMode === 'compare' ? 'patch' : displayMode;
}

function updateSkeletonButtonLabel(): void {
  const labels: Record<ModelId, string> = {
    patch: 'Patch Knight',
    original: 'original Nordic Knight',
    redesigned: 'Knight V2',
  };
  const action = skeletonButton.getAttribute('aria-pressed') === 'true' ? 'Hide' : 'Show';
  skeletonButton.textContent = `${action} ${labels[activeSkeletonModel()]} rig`;
}

function updateSkeletonHelper(): void {
  const visible = skeletonButton.getAttribute('aria-pressed') === 'true';
  const modelId = activeSkeletonModel();
  const model = modelRoots[modelId];
  if (!visible || !model) {
    if (skeletonHelper) skeletonHelper.visible = false;
    return;
  }
  if (skeletonHelper && skeletonModelId === modelId) {
    skeletonHelper.visible = true;
    return;
  }
  if (skeletonHelper) {
    scene.remove(skeletonHelper);
    skeletonHelper.geometry.dispose();
    (skeletonHelper.material as THREE.Material).dispose();
  }
  skeletonHelper = new THREE.SkeletonHelper(model);
  skeletonHelper.material = new THREE.LineBasicMaterial({
    color: 0x9edbc1,
    depthTest: false,
    toneMapped: false,
  });
  skeletonHelper.renderOrder = 10;
  skeletonModelId = modelId;
  scene.add(skeletonHelper);
  arrangeModels();
}

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.view as ViewName | undefined;
    if (view && view in views) showView(view);
  });
});
document.querySelectorAll<HTMLButtonElement>('[data-models]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.models as DisplayMode | undefined;
    if (mode === 'compare' || mode === 'patch' || mode === 'original' || mode === 'redesigned') selectModels(mode);
  });
});

skeletonButton.addEventListener('click', () => {
  const visible = skeletonButton.getAttribute('aria-pressed') !== 'true';
  skeletonButton.setAttribute('aria-pressed', String(visible));
  updateSkeletonButtonLabel();
  updateSkeletonHelper();
});

function addStat(container: HTMLElement, label: string, value: string): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  container.append(term, description);
}

function collectStats(id: ModelId, gltf: GLTF, model: THREE.Object3D): void {
  let meshCount = 0;
  let skinnedCount = 0;
  let triangles = 0;
  let rigidVertices = 0;
  let blendedVertices = 0;
  const bones = new Set<THREE.Bone>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshCount++;
    if (object instanceof THREE.SkinnedMesh) {
      skinnedCount++;
      object.skeleton.bones.forEach((bone) => bones.add(bone));
      const weights = object.geometry.getAttribute('skinWeight');
      if (weights) {
        for (let vertex = 0; vertex < weights.count; vertex++) {
          let influences = 0;
          for (let component = 0; component < 4; component++) {
            if (weights.getComponent(vertex, component) > 1e-4) influences++;
          }
          if (influences > 1) blendedVertices++;
          else rigidVertices++;
        }
      }
    }
    const geometry = object.geometry;
    triangles += Math.floor((geometry.index?.count ?? geometry.getAttribute('position').count) / 3);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
    object.castShadow = true;
    object.receiveShadow = true;
  });

  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  const section = document.createElement('section');
  section.className = 'model-stats-group';
  const heading = document.createElement('h2');
  const headings: Record<ModelId, string> = {
    patch: 'PATCH ANIMATED KNIGHT',
    original: 'ORIGINAL NORDIC KNIGHT',
    redesigned: 'PROCEDURAL NORDIC V2',
  };
  heading.textContent = headings[id];
  section.append(heading);
  const list = document.createElement('dl');
  addStat(list, 'HEIGHT', `${size.y.toFixed(2)} m`);
  addStat(list, 'GEOMETRY', `${triangles.toLocaleString()} triangles · ${meshCount} meshes`);
  const weighting = blendedVertices
    ? `${blendedVertices.toLocaleString()} blended · ${rigidVertices.toLocaleString()} rigid vertices`
    : `${rigidVertices.toLocaleString()} single-joint vertices`;
  addStat(list, 'RIG', `${bones.size} bones · ${skinnedCount} skinned meshes · ${weighting}`);
  addStat(list, 'MATERIALS', `${materials.size} PBR surfaces`);
  addStat(list, 'TEXTURES', `${textures.size} loaded maps`);
  addStat(list, 'ANIMATION', gltf.animations.length ? `${gltf.animations.length} clips` : 'Static bind pose');
  section.append(list);
  stats!.append(section);

  if (id === 'patch') {
    const roots = [...bones].filter((bone) =>
      !(bone.parent instanceof THREE.Bone && bones.has(bone.parent)),
    );
    const lines: string[] = [];
    const appendBone = (bone: THREE.Bone, depth: number): void => {
      const position = bone.getWorldPosition(new THREE.Vector3());
      lines.push(
        `${'  '.repeat(depth)}${bone.name}  (${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)})`,
      );
      for (const child of bone.children) {
        if (child instanceof THREE.Bone && bones.has(child)) appendBone(child, depth + 1);
      }
    };
    roots.forEach((bone) => appendBone(bone, 0));
    hierarchy.textContent = lines.join('\n');
  }
}

function normalizeModel(model: THREE.Object3D, stage: THREE.Group): void {
  stage.add(model);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  model.scale.multiplyScalar(1.86 / Math.max(size.y, 0.001));
  model.updateMatrixWorld(true);
  const normalizedBounds = new THREE.Box3().setFromObject(model);
  const center = normalizedBounds.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= normalizedBounds.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
}

async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const assets: Record<ModelId, string> = {
    patch: new URL('./assets/characters/patch-knight/animatedKnightInPlateArmour.glb', document.baseURI).href,
    original: new URL('./assets/characters/preview/nordic-knight.glb', document.baseURI).href,
    redesigned: new URL('./assets/characters/preview/nordic-knight-v2.glb', document.baseURI).href,
  };
  try {
    const [patch, original, redesigned] = await Promise.all([
      loader.loadAsync(assets.patch),
      loader.loadAsync(assets.original),
      loader.loadAsync(assets.redesigned),
    ]);
    for (const [id, gltf] of [
      ['patch', patch],
      ['original', original],
      ['redesigned', redesigned],
    ] as const) {
      modelRoots[id] = gltf.scene;
      normalizeModel(gltf.scene, stages[id]);
      collectStats(id, gltf, gltf.scene);
    }
    patchMixer = new THREE.AnimationMixer(patch.scene);
    patchClips = patch.animations;
    patchAnimationPicker.replaceChildren(...patch.animations.map((clip) => {
      const option = document.createElement('option');
      option.value = clip.name;
      option.textContent = `${clip.name} · ${clip.duration.toFixed(2)} s`;
      return option;
    }));
    patchAnimationPicker.disabled = patch.animations.length === 0;
    patchAnimationPlay.disabled = patch.animations.length === 0;
    patchAnimationStatus.textContent = patch.animations.length
      ? `${patch.animations.length} source clips in the downloaded GLB.`
      : 'The Patch GLB contains no animation clips.';
    skeletonButton.disabled = false;
    updateSkeletonButtonLabel();
    modelStatus.dataset.state = 'ready';
    modelStatus.textContent = 'PATCH, ORIGINAL, AND V2 GLBS LOADED';
    arrangeModels();
  } catch (error) {
    console.error('Knight comparison GLB failed to load.', error);
    modelStatus.dataset.state = 'error';
    modelStatus.textContent = 'MODEL LOAD FAILED · CHECK CONSOLE';
    hierarchy.textContent = 'A Knight GLB failed to load. Check the browser console and network panel.';
  }
}

patchAnimationPlay.addEventListener('click', () => {
  if (!patchMixer) return;
  const option = patchAnimationPicker.selectedOptions[0];
  if (!option) return;
  const loadedClipName = option.value;
  const selectedClip = patchClips.find((candidate) => candidate.name === loadedClipName);
  if (!selectedClip) {
    patchAnimationStatus.textContent = `Clip "${loadedClipName}" is not available.`;
    return;
  }
  patchActiveAction?.fadeOut(0.18);
  const action = patchMixer.clipAction(selectedClip);
  action.reset();
  const loops = ['Idle', 'Walk', 'Run', 'Walk_Root', 'Run_Root'].includes(selectedClip.name);
  action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, loops ? Infinity : 1);
  action.clampWhenFinished = !loops;
  action.fadeIn(0.18).play();
  patchActiveAction = action;
  patchAnimationStatus.textContent = `${selectedClip.name} · playing ${loops ? 'loop' : 'once'}.`;
});

function resize(): void {
  const width = Math.max(1, canvas!.clientWidth);
  const height = Math.max(1, canvas!.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const delta = Math.min(clock.getDelta(), 0.05);
  camera.position.lerp(cameraDestination, 1 - Math.exp(-5 * delta));
  controls.target.lerp(targetDestination, 1 - Math.exp(-5 * delta));
  controls.update();
  patchMixer?.update(delta);
  renderer.render(scene, camera);
});
window.addEventListener('resize', resize);
window.addEventListener('resize', arrangeModels);
resize();
showView('front');
void loadModels();
