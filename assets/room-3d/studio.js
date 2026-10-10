(() => {
  'use strict';

  const status = document.getElementById('status');
  const saveButton = document.getElementById('save-png');
  const exportButton = document.getElementById('export-glb');
  const buildMode = new URLSearchParams(window.location.search).get('build') === '1';
  const studio = window.roomStudio = {
    ready: false,
    scene: null,
    camera: null,
    renderer: null,
    manifest: null,
    capture() {
      if (!this.ready) throw new Error('Комната ещё не загружена.');
      return this.renderer.domElement.toDataURL('image/png');
    }
  };

  function showError(error) {
    status.textContent = `Ошибка: ${error.message || error}`;
    status.hidden = false;
  }

  async function readJSON(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  function toBase64(buffer) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([buffer], { type: 'model/gltf-binary' }));
    });
  }

  window.exportRoomModels = async () => {
    try {
      if (!window.Room3D) throw new Error('Не загружен room-tools.min.js.');
      if (!window.createRoomModels) throw new Error('Не загружен models-source.js.');
      status.hidden = false;
      status.textContent = 'Экспорт отдельных GLB…';
      const source = window.createRoomModels(window.Room3D);
      const exporter = new window.Room3D.GLTFExporter();
      const manifest = { objects: [] };
      const models = [];
      for (const { id, model, position, quaternion, scale } of source) {
        const binary = await exporter.parseAsync(model, { binary: true, onlyVisible: true });
        models.push({ id, data: await toBase64(binary) });
        manifest.objects.push({
          id,
          file: `${id}.glb`,
          position: Array.from(position),
          quaternion: Array.from(quaternion),
          scale: Array.from(scale)
        });
      }
      status.textContent = `Экспортировано объектов: ${models.length}.`;
      return { manifest, models };
    } catch (error) {
      showError(error);
      throw error;
    }
  };

  function restoreMetadata(root, THREE) {
    root.traverse(object => {
      if (!object.isMesh) return;
      const metadata = object.userData;
      if (typeof metadata.castShadow === 'boolean') object.castShadow = metadata.castShadow;
      if (typeof metadata.receiveShadow === 'boolean') object.receiveShadow = metadata.receiveShadow;
      const restoreMaterial = material => {
        const unlit = material.userData.unlit ?? metadata.unlit;
        if (unlit === true && !material.isMeshBasicMaterial) {
          const original = material;
          material = new THREE.MeshBasicMaterial({
            color: original.color,
            map: original.map,
            alphaMap: original.alphaMap,
            transparent: original.transparent,
            opacity: original.opacity,
            alphaTest: original.alphaTest,
            side: original.side,
            depthTest: original.depthTest,
            depthWrite: original.depthWrite,
            vertexColors: original.vertexColors
          });
          material.name = original.name;
          material.userData = original.userData;
        }
        const toneMapped = material.userData.toneMapped ?? metadata.toneMapped;
        if (typeof toneMapped === 'boolean') material.toneMapped = toneMapped;
        return material;
      };
      object.material = Array.isArray(object.material)
        ? object.material.map(restoreMaterial)
        : restoreMaterial(object.material);
    });
  }

  async function loadRoom() {
    const THREE = window.Room3D;
    if (!THREE) throw new Error('Не загружен room-tools.min.js.');
    const [view, manifest] = await Promise.all([readJSON('view.json'), readJSON('models/scene.json')]);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(view.width, view.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = view.lighting.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('viewport').appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const config = view.camera;
    const camera = new THREE.PerspectiveCamera(config.fov, view.width / view.height, config.near, config.far);
    camera.position.fromArray(config.position);
    camera.lookAt(...config.target);
    const { hemisphere, sun, fill } = view.lighting;
    scene.add(new THREE.HemisphereLight(hemisphere.sky, hemisphere.ground, hemisphere.intensity));
    const sunlight = new THREE.DirectionalLight(sun.color, sun.intensity);
    sunlight.position.fromArray(sun.position);
    sunlight.castShadow = true;
    sunlight.shadow.mapSize.set(2048, 2048);
    Object.assign(sunlight.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 20 });
    sunlight.shadow.normalBias = 0.025;
    sunlight.shadow.bias = -0.00015;
    sunlight.shadow.radius = 3;
    scene.add(sunlight, sunlight.target);
    const fillLight = new THREE.DirectionalLight(fill.color, fill.intensity);
    fillLight.position.fromArray(fill.position);
    scene.add(fillLight);

    Object.assign(studio, { scene, camera, renderer, manifest });
    const loader = new THREE.GLTFLoader();
    const roots = await Promise.all(manifest.objects.map(async entry => {
      const gltf = await loader.loadAsync(`models/${entry.file}`);
      const root = gltf.scene;
      root.name = entry.id;
      root.position.fromArray(entry.position);
      root.quaternion.fromArray(entry.quaternion);
      root.scale.fromArray(entry.scale);
      restoreMetadata(root, THREE);
      return root;
    }));
    scene.add(...roots);
    renderer.render(scene, camera);
    studio.ready = true;
    status.textContent = `Загружено объектов: ${roots.length}. Размер PNG: ${view.width} × ${view.height}.`;
    saveButton.hidden = false;
  }

  saveButton.addEventListener('click', () => {
    try {
      const link = document.createElement('a');
      link.download = 'room-view.png';
      link.href = studio.capture();
      link.click();
    } catch (error) {
      showError(error);
    }
  });

  exportButton.addEventListener('click', async () => {
    if (!window.showDirectoryPicker) {
      status.textContent = 'Для экспорта в папку нужен Chrome/Chromium с File System Access API. Консольный window.exportRoomModels() остаётся доступен.';
      return;
    }
    exportButton.disabled = true;
    try {
      const directory = await window.showDirectoryPicker({ mode: 'readwrite' });
      const { manifest, models } = await window.exportRoomModels();
      for (const { id, data } of models) {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const handle = await directory.getFileHandle(`${id}.glb`, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
      }
      const manifestHandle = await directory.getFileHandle('scene.json', { create: true });
      const writable = await manifestHandle.createWritable();
      await writable.write(JSON.stringify(manifest, null, 2) + '\n');
      await writable.close();
      status.textContent = `Сохранено GLB: ${models.length}, манифест: scene.json. Откройте студию без ?build=1 для просмотра.`;
    } catch (error) {
      if (error.name === 'AbortError') status.textContent = 'Экспорт отменён: папка не выбрана.';
      else showError(error);
    } finally {
      exportButton.disabled = false;
    }
  });

  if (buildMode) {
    status.textContent = 'Режим сборки: готово к экспорту GLB. Сцена не загружается.';
  } else {
    loadRoom().catch(showError);
  }
})();
