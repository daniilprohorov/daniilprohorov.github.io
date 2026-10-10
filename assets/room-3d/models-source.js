'use strict';
// Geometry and locally drawn texture provenance: the original room-3d.html
// static Three.js 0.180.0 visual prototype. Its Magic Cap palette is unchanged.
// No renderer, camera, scene layout or external textures are required here.
window.createRoomModels = function createRoomModels(THREE) {
 const room = new THREE.Group();
 const models = [];
 const material = (color, roughness = .65, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
 const M = {
  wall: material('#50b7c0', .92), side: material('#78cdd0', .92), trim: material('#eeeada'),
  desk: material('#c7bd55', .58), deskEdge: material('#b3a344'), drawer: material('#c5b655'),
  wood: material('#bc9064', .85), woodLight: material('#ceaa7e', .85), woodDark: material('#ac8058', .85),
  cream: material('#f1eee2', .45), paper: material('#fff9e9', .9), charcoal: material('#293841', .52),
  rubber: material('#253039', .95), steel: material('#aebbc0', .27, .72), blue: material('#3c729a', .48),
  red: material('#cb6650', .4), orange: material('#d4884b', .7), leaf: material('#477f50', .85),
  leafLight: material('#79a264', .85), soil: material('#564337', 1), coffee: material('#543a2a', .25),
  cloth: material('#547f9c', .97), seam: material('#426981', 1), yellow: material('#f3d767', .9),
  glass: material('#96c9e1', .3), building: material('#c6b7ac', .9), roof: material('#667a87', .8),
  teal: material('#248a96', .55), filament: material('#e88b50', .63)
 };
 const geometries = new Map();
 function mesh(geometry, mat, x, y, z, parent = room) {
  const item = new THREE.Mesh(geometry, mat);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  parent.add(item);
  return item;
 }
 function box(w, h, d, mat, x, y, z, parent = room, radius = 0) {
  const key = [w, h, d, radius].join('/');
  let geometry = geometries.get(key);
  if (!geometry) {
   if (radius) {
    const r = Math.min(radius, w / 3, h / 3, d / 3);
    const bevel = Math.min(r / 3, d / 5);
    const a = w / 2 - bevel, b = h / 2 - bevel;
    const shape = new THREE.Shape();
    shape.moveTo(-a + r, -b); shape.lineTo(a - r, -b);
    shape.quadraticCurveTo(a, -b, a, -b + r); shape.lineTo(a, b - r);
    shape.quadraticCurveTo(a, b, a - r, b); shape.lineTo(-a + r, b);
    shape.quadraticCurveTo(-a, b, -a, b - r); shape.lineTo(-a, -b + r);
    shape.quadraticCurveTo(-a, -b, -a + r, -b);
    geometry = new THREE.ExtrudeGeometry(shape, {depth: d - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6, steps: 1});
    geometry.translate(0, 0, -d / 2 + bevel);
   } else geometry = new THREE.BoxGeometry(w, h, d);
   geometries.set(key, geometry);
  }
  return mesh(geometry, mat, x, y, z, parent);
 }
 function cylinder(r, height, mat, x, y, z, parent = room, rTop = r) {
  const key = `c/${r}/${height}/${rTop}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.CylinderGeometry(rTop, r, height, 32));
  return mesh(geometries.get(key), mat, x, y, z, parent);
 }
 function sphere(r, mat, x, y, z, parent = room) {
  const key = `s/${r}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.SphereGeometry(r, 24, 16));
  return mesh(geometries.get(key), mat, x, y, z, parent);
 }
 function torus(r, tube, mat, x, y, z, parent = room, arc = Math.PI * 2) {
  const key = `t/${r}/${tube}/${arc}`;
  if (!geometries.has(key)) geometries.set(key, new THREE.TorusGeometry(r, tube, 12, 72, arc));
  return mesh(geometries.get(key), mat, x, y, z, parent);
 }
 function rod(a, b, radius, mat, parent = room) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const object = cylinder(radius, start.distanceTo(end), mat, ...start.clone().add(end).multiplyScalar(.5).toArray(), parent);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize());
  return object;
 }
 function cable(points, mat, radius = .009, parent = room) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(new THREE.TubeGeometry(curve, 32, radius, 6, false), mat, 0, 0, 0, parent);
 }
 function group(name, x, y, z, parent = room, standalone = true) {
  const object = new THREE.Group();
  object.name = name;
  object.position.set(x, y, z);
  parent.add(object);
  if (standalone) models.push({id: name, model: object});
  return object;
 }
 function texture(w, h, draw) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  draw(canvas.getContext('2d'), w, h);
  const result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  result.anisotropy = 4;
  return result;
 }
 function panel(w, h, map, x, y, z, parent = room) {
  return mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({map, side: THREE.DoubleSide, toneMapped: false}), x, y, z, parent);
 }
 // Subtle material detail is generated locally, rather than downloaded as photo assets.
 let seed = 71;
 const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
 const grain = texture(512, 128, (c, w, h) => {
  c.fillStyle = '#fffaf1'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 95; i++) {
   const y = random() * h, bend = random() * 10 - 5;
   c.strokeStyle = `rgba(103,76,49,${.025 + random() * .08})`;
   c.lineWidth = .3 + random() * .65;
   c.beginPath(); c.moveTo(0, y); c.bezierCurveTo(w * .3, y + bend, w * .7, y - bend, w, y); c.stroke();
  }
 });
 for (const mat of [M.wood, M.woodLight, M.woodDark]) mat.map = grain;
 const surface = texture(128, 128, (c, w, h) => {
  const image = c.createImageData(w, h);
  for (let i = 0; i < image.data.length; i += 4) {
   const value = 110 + Math.floor(random() * 36);
   image.data[i] = image.data[i + 1] = image.data[i + 2] = value; image.data[i + 3] = 255;
  }
  c.putImageData(image, 0, 0);
 });
 surface.colorSpace = THREE.NoColorSpace;
 surface.wrapS = surface.wrapT = THREE.RepeatWrapping; surface.repeat.set(5, 3);
 M.desk.bumpMap = surface; M.desk.bumpScale = .003;
 // Interior shell for the seated view; the window remains a real opening.
 const architecture = group('room-shell', 0, 0, 0);
 box(7.5, .2, 5.6, M.trim, 0, -.14, .25, architecture, .08);
 for (let row = 0; row < 14; row++) {
  for (let col = 0; col < 6; col++) {
   const start = -3.68 - (row % 2) * .74 + col * 1.48;
   const left = Math.max(-3.68, start), right = Math.min(3.68, start + 1.48);
   if (right <= left) continue;
   const mat = [M.wood, M.woodLight, M.woodDark][(row * 7 + col * 2 + Math.floor(row / 2)) % 3];
   box(right - left - .012, .045, .388, mat, (left + right) / 2, -.018, -2.36 + row * .397, architecture);
  }
 }
 // Window bounds: x -0.5..1.65, y 1.95..3.48.
 box(7.5, 1.95, .15, M.wall, 0, .975, -2.5, architecture);
 box(7.5, 2.02, .15, M.wall, 0, 4.49, -2.5, architecture);
 box(3.25, 1.53, .15, M.wall, -2.125, 2.715, -2.5, architecture);
 box(2.1, 1.53, .15, M.wall, 2.7, 2.715, -2.5, architecture);
 box(.15, 5.5, 5.6, M.side, -3.75, 2.75, .25, architecture);
 box(.15, 5.5, 5.6, M.wall, 3.75, 2.75, .25, architecture);
 box(7.65, .15, 5.72, M.trim, 0, 5.575, .25, architecture);
 box(7.35, .14, .07, M.trim, .05, .08, -2.38, architecture);
 box(.07, .14, 5.48, M.trim, -3.64, .08, .25, architecture);
 box(.07, .14, 5.48, M.trim, 3.64, .08, .25, architecture);
 // Thin cream cornice makes the thickness and scale of the walls readable.
 box(7.65, .08, .22, M.trim, 0, 5.5, -2.5, architecture);
 box(.22, .08, 5.72, M.trim, -3.75, 5.5, .25, architecture);
 box(.22, .08, 5.72, M.trim, 3.75, 5.5, .25, architecture);
 // Keep the illustrated interior evenly lit; furniture still casts real shadows
 // onto the shell, but off-screen walls do not occlude the broad authoring light.
 architecture.traverse(object => { if (object.isMesh) object.castShadow = false; });
 const win = group('window-and-rooftops', .575, 2.715, -2.5);
 const sky = new THREE.MeshBasicMaterial({color:'#b9d9ed'});
 box(2.15, 1.53, .035, sky, 0, 0, -.27, win);
 const city = [ [-.87, .31, .48], [-.48, .42, .60], [-.06, .39, .37], [.37, .46, .66], [.85, .38, .50] ];
 city.forEach(([x, w, h], i) => {
  box(w, h, .09, M.building, x, -.74 + h / 2, -.20, win);
  const roof = box(w + .05, .06, .13, M.roof, x, -.74 + h, -.19, win);
  roof.rotation.z = i % 2 ? .035 : -.035;
  box(.065, .15, .055, M.roof, x + .07, -.66 + h, -.2, win);
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) box(.057, .085, .01, M.cream, x - .085 + col * .16, -.60 + row * .16, -.145, win);
 });
 [-1.1, 1.1].forEach(x => box(.09, 1.67, .15, M.cream, x, 0, .03, win));
 [-.80, .80].forEach(y => box(2.29, .09, .15, M.cream, 0, y, .03, win));
 box(.065, 1.55, .13, M.cream, 0, 0, .055, win);
 box(2.15, .065, .13, M.cream, 0, -.02, .055, win);
 box(2.43, .10, .43, M.cream, 0, -.86, .14, win, .025);
 box(.028, .09, .03, M.steel, .07, -.17, .145, win, .008);
 // Desk, drawers and steel frame.
 const desk = group('workbench', -.25, 0, -.30);
 const top = 1.52;
 box(4.65, .14, 1.85, M.desk, 0, top - .07, 0, desk, .055);
 box(4.58, .027, .045, M.deskEdge, 0, top - .12, .924, desk);
 for (const x of [-2.08, 2.08]) for (const z of [-.65, .65]) box(.07, 1.35, .07, M.charcoal, x, .68, z, desk, .018);
 rod([-2.08, .30, -.65], [2.08, .30, -.65], .026, M.steel, desk);
 box(.9, 1.03, 1.54, M.drawer, -1.68, .91, 0, desk, .025);
 for (let i = 0; i < 3; i++) {
  box(.85, .305, .055, M.desk, -1.68, .59 + i * .325, .792, desk, .012);
  box(.28, .027, .04, M.cream, -1.68, .62 + i * .325, .837, desk, .008);
 }
 // Detailed open-frame printer, rails, spool, print head and a printed orange part.
 const printer = group('3d-printer', -1.60, top, -.30, desk);
 box(.88, .15, .81, M.charcoal, 0, .075, 0, printer, .035);
 for (const x of [-.36, .36]) {
  box(.045, .87, .045, M.charcoal, x, .54, -.23, printer);
  rod([x, .18, -.16], [x, .94, -.16], .012, M.steel, printer);
  box(.09, .09, .11, M.charcoal, x, .17, -.23, printer, .012);
 }
 box(.80, .055, .07, M.charcoal, 0, .99, -.23, printer);
 box(.75, .042, .07, M.steel, 0, .65, -.12, printer);
 box(.67, .032, .60, M.steel, 0, .225, .035, printer);
 box(.63, .012, .56, M.charcoal, 0, .246, .035, printer);
 box(.14, .15, .14, M.charcoal, .03, .58, -.095, printer, .02);
 cylinder(.018, .04, M.orange, .03, .485, -.065, printer, .006);
 const printerPrototype = group('printer-prototype', .04, .327, .06, printer);
 cylinder(.12, .15, M.filament, 0, 0, 0, printerPrototype);
 const rim = torus(.087, .022, M.filament, 0, .087, 0, printerPrototype); rim.rotation.x = Math.PI / 2;
 for (let i = 0; i < 8; i++) { const ring = torus(.1205, .0018, M.orange, 0, -.065 + i * .019, 0, printerPrototype); ring.rotation.x = Math.PI / 2; }
 rod([.29, .99, -.23], [.29, 1.15, -.23], .016, M.charcoal, printer);
 const spool = cylinder(.15, .12, M.filament, .29, 1.16, -.23, printer); spool.rotation.x = Math.PI / 2;
 for (const z of [-.31, -.15]) { const flange = cylinder(.175, .018, M.charcoal, .29, 1.16, z, printer); flange.rotation.x = Math.PI / 2; }
 cable([[.29, 1.15, -.15], [.31, 1.25, .02], [.08, 1.10, .06], [.03, .65, -.08]], M.cream, .006, printer);
 const printerScreen = texture(256, 96, c => {c.fillStyle='#203840';c.fillRect(0,0,256,96);c.fillStyle='#94d9d2';c.font='20px monospace';c.fillText('PRINT / 08',15,30);c.fillStyle='#e7b65c';c.fillRect(15,52,164,10);c.fillStyle='#8bb2b7';c.font='14px monospace';c.fillText('PLA  210°   64%',15,84);});
 panel(.27, .1, printerScreen, -.16, .083, .413, printer);
 const knob = cylinder(.04, .025, M.steel, .27, .08, .426, printer); knob.rotation.x = Math.PI / 2;
 // Computer with thickness, bevels, stand and a drawn CAD viewport on an emissive screen.
 const monitor = group('monitor', .12, top, -.42, desk);
 box(.68, .035, .40, M.cream, 0, .022, .05, monitor, .016);
 box(.095, .34, .09, M.steel, 0, .19, -.055, monitor, .016);
 box(1.30, .83, .12, M.cream, 0, .71, -.02, monitor, .045);
 const display = texture(1024, 640, (c,w,h) => {
  c.fillStyle='#243f52';c.fillRect(0,0,w,h);c.fillStyle='#1c303e';c.fillRect(0,0,w,48);c.fillRect(0,48,138,h);
  c.font='19px monospace';c.fillStyle='#d9e9e7';c.fillText('hub_v12   /   perspective',160,31);
  c.font='15px monospace';['PROJECT','▸ hub_v12','  body','  axle','  bearings'].forEach((t,i)=>c.fillText(t,15,90+i*37));
  c.strokeStyle='#426274';c.lineWidth=1;
  for(let i=-8;i<10;i++){c.beginPath();c.moveTo(160,340+i*33);c.lineTo(w,570+i*33);c.stroke();c.beginPath();c.moveTo(280+i*70,640);c.lineTo(630+i*70,200);c.stroke();}
  c.strokeStyle='#b5d5df';c.lineWidth=3;
  c.fillStyle='#729eaa';c.beginPath();c.moveTo(425,294);c.lineTo(725,237);c.lineTo(788,374);c.lineTo(487,438);c.closePath();c.fill();c.stroke();
  c.fillStyle='#a7ccd0';c.beginPath();c.ellipse(432,364,52,78,-.39,0,Math.PI*2);c.fill();c.stroke();
  c.fillStyle='#88b5bd';c.beginPath();c.ellipse(755,304,52,78,-.39,0,Math.PI*2);c.fill();c.stroke();
  c.fillStyle='#243f52';c.beginPath();c.ellipse(755,304,22,36,-.39,0,Math.PI*2);c.fill();c.stroke();
  c.strokeStyle='#d4ae61';c.lineWidth=6;c.beginPath();c.moveTo(381,379);c.lineTo(822,287);c.stroke();
  c.fillStyle='#96b7c3';c.font='16px monospace';c.fillText('36 inch / custom hub',172,606);
 });
 const screenMaterial = new THREE.MeshStandardMaterial({map:display,emissiveMap:display,emissive:'#ffffff',emissiveIntensity:.35,roughness:.38});
 mesh(new THREE.PlaneGeometry(1.17,.68), screenMaterial, 0,.72,.043,monitor);
 sphere(.009, M.teal, .56,.35,.047,monitor);
 cable([[.02,.15,-.09],[.1,.04,-.3],[.65,.026,-.42],[.78,-.1,-.89]], M.charcoal, .009, monitor);
 // Two keyboard halves: individual keycaps, staggered rows and contrasting thumb keys.
 const keyboard = group('keyboard-cables', .15, top, .48, desk);
 function half(x, angle, mirrored) {
  const part = group(mirrored ? 'keyboard-right' : 'keyboard-left', x, 0, 0, keyboard); part.rotation.y = angle;
  box(.49,.055,.34,M.blue,0,.028,0,part,.025);
  for(let row=0;row<3;row++) for(let col=0;col<5;col++) {
   const key = box(.072,.039,.072,(col===0&&row===0)?M.red:M.cream,-.18+col*.087,.073,-.112+row*.086+(col===2?-.012:0),part,.009);
   if(row===1){box(.022,.001,.003,M.charcoal,key.position.x,.094,key.position.z,part);}
  }
  for(let i=0;i<2;i++)box(.094,.039,.065,i?M.cream:M.yellow,(mirrored?-1:1)*(.03+i*.115),.073,.137,part,.009);
 }
 half(-.30,-.15,false); half(.30,.15,true);
 cable([[-.14,.03,-.17],[0,.045,-.27],[.14,.03,-.17]],M.charcoal,.007,keyboard);
 cable([[.3,.027,-.17],[.46,.035,-.29],[.48,.024,-.48],[.3,.024,-.69]],M.charcoal,.006,keyboard);
 const trackball = group('trackball', .89, top, .48, desk);
 const mouse = sphere(.135,M.cream,0,.052,0,trackball);mouse.scale.set(.75,.5,1.15);
 sphere(.059,M.red,0,.113,-.016,trackball);
 box(.006,.002,.045,M.charcoal,.06,.106,.022,trackball);
 // Notebook, diagram, pencil and a pair of small printed mechanical parts.
 const notebook = group('open-notebook',1.53,top+.025,.42,desk);notebook.rotation.y=-.20;
 box(.72,.022,.48,M.blue,0,0,0,notebook,.008);
 const notes = texture(768,512,(c,w,h)=>{
  c.fillStyle='#fff8e6';c.fillRect(0,0,w,h);c.strokeStyle='#d6d4c8';c.lineWidth=1;for(let y=60;y<h;y+=33){c.beginPath();c.moveTo(24,y);c.lineTo(w-24,y);c.stroke();}
  c.strokeStyle='#c6bca5';c.lineWidth=4;c.beginPath();c.moveTo(w/2,0);c.lineTo(w/2,h);c.stroke();
  c.fillStyle='#496576';c.font='22px monospace';c.fillText('HUB / 36"',35,40);c.font='18px monospace';['01 — bearing fit','02 — axle Ø17','03 — print test','04 — try again'].forEach((s,i)=>c.fillText(s,30,110+i*64));
  c.strokeStyle='#4e7287';c.lineWidth=3;c.strokeRect(459,188,222,110);[470,670].forEach(x=>{c.beginPath();c.ellipse(x,242,20,86,0,0,Math.PI*2);c.stroke();});c.beginPath();c.moveTo(422,242);c.lineTo(720,242);c.stroke();c.font='16px monospace';c.fillText('v12 / section A',440,424);
 });
 const pages=panel(.69,.45,notes,0,.012,0,notebook);pages.rotation.x=-Math.PI/2;
 rod([-.36,.014,-.24],[-.36,.014,.24],.010,M.paper,notebook);
 const pencil=group('pencil',1.95,top+.018,.19,desk);
 rod([0,0,0],[.12,0,.42],.012,M.orange,pencil);cylinder(.012,.015,M.charcoal,.12,0,.42,pencil);
 const roundPrototype=group('round-prototype',-.82,top+.005,.58,desk);
 cylinder(.102,.063,M.filament,0,.033,0,roundPrototype);
 const partRing=torus(.067,.019,M.orange,0,.065,0,roundPrototype);partRing.rotation.x=Math.PI/2;
 const squarePrototype=group('square-prototype',-.57,top+.005,.68,desk);
 box(.15,.036,.15,M.teal,0,.019,0,squarePrototype,.018);const hole=torus(.035,.014,M.cream,0,.039,0,squarePrototype);hole.rotation.x=Math.PI/2;
 const sticky=texture(256,256,c=>{c.fillStyle='#f7d96b';c.fillRect(0,0,256,256);c.fillStyle='#665c3d';c.font='24px monospace';c.fillText('ещё одну',20,100);c.fillText('итерацию',20,138);});
 const note=group('sticky-note',.54,top+.003,.74,desk);note.rotation.set(-Math.PI/2,0,-.12);
 panel(.23,.23,sticky,0,0,0,note);
 // Ceramic cup has an open rim, visible coffee and a curved handle.
 const mug=group('coffee-mug',-.79,top,-.16,desk);
 const cupProfile=[new THREE.Vector2(.0,.0),new THREE.Vector2(.085,.0),new THREE.Vector2(.092,.015),new THREE.Vector2(.095,.19),new THREE.Vector2(.085,.20),new THREE.Vector2(.077,.185),new THREE.Vector2(.076,.025),new THREE.Vector2(.0,.025)];
 mesh(new THREE.LatheGeometry(cupProfile,40),M.cream,0,0,0,mug);
 cylinder(.077,.006,M.coffee,0,.173,0,mug);
 const handle=torus(.06,.014,M.cream,-.105,.105,0,mug,Math.PI*1.55);handle.rotation.z=-Math.PI*.775;
 // Articulated red task lamp; the inner shade and light face the desk, not the viewer.
 const lamp=group('task-lamp',1.60,top,-.40,desk);
 cylinder(.19,.035,M.red,0,.019,0,lamp);
 rod([0,.04,0],[.15,.58,-.025],.022,M.charcoal,lamp);
 rod([.15,.58,-.025],[-.14,.99,-.13],.022,M.charcoal,lamp);
 [ [0,.05,0],[.15,.58,-.025],[-.14,.99,-.13] ].forEach(p=>sphere(.036,M.steel,...p,lamp));
 const shade=group('lamp-shade',-.14,.94,-.13,lamp,false);shade.rotation.z=-.35;
 const profile=[new THREE.Vector2(.05,.15),new THREE.Vector2(.16,-.10),new THREE.Vector2(.147,-.10),new THREE.Vector2(.039,.14)];
 mesh(new THREE.LatheGeometry(profile,40),M.red,0,0,0,shade);
 const bulb=sphere(.055,new THREE.MeshStandardMaterial({color:'#fff1c2',emissive:'#ffc776',emissiveIntensity:1}),0,-.045,0,shade);
 const warm=new THREE.PointLight('#ffd59c',.65,1.8,2);warm.position.set(-.14,.80,-.13);lamp.add(warm);
 // Small shelf with recognizable old phones, books and a filament spool.
 const shelf=group('parts-shelf',-2.51,2.71,-2.27);
 box(1.42,.065,.36,M.desk,0,0,0,shelf,.018);
 for(const x of [-.48,.48]){rod([x,-.24,-.10],[x,-.035,.15],.016,M.charcoal,shelf);rod([x,-.24,-.10],[x,-.035,-.10],.016,M.charcoal,shelf);}
 function phone(x,color,qwerty=false){
  const p=group(qwerty?'old-phone-qwerty':'old-phone-keypad',x,.22,0,shelf);p.rotation.x=-.08;
  box(qwerty?.25:.18,.36,.067,color,0,0,0,p,.028);
  box(qwerty?.21:.13,.14,.009,M.charcoal,0,.065,.039,p,.008);
  box(qwerty?.18:.10,.11,.003,material('#9cac8b'),0,.065,.045,p,.003);
  box(.04,.014,.005,M.steel,0,.156,.04,p);
  for(let r=0;r<3;r++)for(let col=0;col<(qwerty?5:3);col++)box(qwerty?.032:.03,.021,.008,M.cream,(col-(qwerty?2:1))*(qwerty?.04:.045),-.047-r*.033,.039,p,.004);
 }
 phone(-.44,M.blue);phone(-.16,M.cream,true);
 for(let i=0;i<3;i++){
  const book=group(`book-${i+1}`,.20+i*.095,.18,0,shelf);
  box(.085,.30+i*.025,.24,[M.red,M.cream,M.teal][i],0,0,0,book,.008);
  box(.05,.016,.004,M.paper,0,.06,.124,book);
 }
 const shelfSpool=group('shelf-spool',.53,.19,0,shelf);
 const spoolBody=cylinder(.16,.12,M.filament,0,0,0,shelfSpool);spoolBody.rotation.x=Math.PI/2;
 for(const z of [-.075,.075]){const f=cylinder(.18,.017,M.charcoal,0,0,z,shelfSpool);f.rotation.x=Math.PI/2;}
 // A taped engineering drawing on the back wall.
 const drawing=texture(512,640,(c,w,h)=>{
  c.fillStyle='#fff7e5';c.fillRect(0,0,w,h);c.strokeStyle='#517487';c.lineWidth=3;[125,94,28].forEach(r=>{c.beginPath();c.arc(256,270,r,0,Math.PI*2);c.stroke();});c.lineWidth=1;[[100,270,411,270],[256,110,256,431],[99,470,413,470],[99,459,99,481],[413,459,413,481]].forEach(p=>{c.beginPath();c.moveTo(p[0],p[1]);c.lineTo(p[2],p[3]);c.stroke();});c.fillStyle='#456272';c.font='24px monospace';c.fillText('CUSTOM HUB / 36"',53,560);c.font='17px monospace';c.fillText('section B — v12',85,597);
 });
 const poster=group('engineering-drawing',-1.16,2.80,-2.406);poster.rotation.z=.045;
 panel(.67,.84,drawing,0,0,0,poster);
 for(const x of [-.23,.23])box(.13,.048,.005,M.yellow,x,.417,.006,poster);
 // Plant lives on the window ledge, with stems and curved, individually oriented leaves.
 const plant=group('windowsill-plant',1.37,1.905,-2.24);
 cylinder(.105,.21,M.red,0,.108,0,plant,.145);
 cylinder(.13,.013,M.soil,0,.211,0,plant);
 for(let i=0;i<6;i++){
  const a=i*2.4, y=.32+i*.043;
  const tip=[Math.cos(a)*.15,y,Math.sin(a)*.12];
  rod([0,.20,0],tip,.007,M.leaf,plant);
  const leaf=sphere(.075,i%2?M.leaf:M.leafLight,...tip,plant);leaf.scale.set(1.05,.23,2.15);leaf.rotation.set(.2,a,.35);
 }
 // Unicycle: large tyre, metal spokes, blue fork, two cranks and pedals.
 const uni=group('unicycle',2.81,.73,-1.23);uni.rotation.set(0,-.28,-.10);
 torus(.64,.055,M.rubber,0,0,0,uni);
 torus(.587,.018,M.steel,0,0,0,uni);
 const axle=cylinder(.048,.23,M.steel,0,0,0,uni);axle.rotation.x=Math.PI/2;
 for(let i=0;i<32;i++){
  const a=i*Math.PI/16, z=i%2?.056:-.056;
  rod([0,0,z],[Math.sin(a)*.585,Math.cos(a)*.585,0],.0025,M.steel,uni);
 }
 for(const z of [-.11,.11]){
  rod([0,0,z],[0,.74,z],.021,M.blue,uni);
  rod([0,.74,z],[0,.87,0],.021,M.blue,uni);
 }
 rod([0,.82,0],[0,1.29,0],.024,M.steel,uni);
 const saddle=box(.36,.065,.17,M.charcoal,0,1.30,0,uni,.055);saddle.rotation.z=.035;
 for(const sign of [-1,1]){
  rod([0,0,sign*.13],[sign*.12,-sign*.12,sign*.13],.014,M.steel,uni);
  rod([sign*.12,-sign*.12,sign*.13],[sign*.12,-sign*.12,sign*.23],.012,M.steel,uni);
  box(.14,.035,.11,M.charcoal,sign*.12,-sign*.12,sign*.27,uni,.012);
 }
 // A canvas backpack beside the wheel, with straps, seams and a front pocket.
 const bag=group('backpack',3.06,0,.09);bag.rotation.y=-.20;
 box(.45,.65,.27,M.orange,0,.36,0,bag,.065);
 box(.34,.27,.06,M.red,0,.25,.155,bag,.045);
 box(.29,.014,.009,M.charcoal,0,.39,.19,bag);
 cable([[-.11,.66,0],[-.10,.79,0],[.10,.79,0],[.11,.66,0]],M.charcoal,.014,bag);
 for(const x of [-.15,.15])cable([[x,.60,-.13],[x,.44,-.23],[x,.13,-.20],[x,.09,-.08]],M.charcoal,.022,bag);
 for(const x of [-.16,.16])rod([x,.12,.143],[x,.59,.143],.004,M.yellow,bag);
 // Upholstered chair angled slightly out from the workbench.
 const chair=group('desk-chair',-.10,0,1.61);chair.rotation.y=-.15;
 box(.86,.12,.79,M.cloth,0,.76,0,chair,.06);
 box(.84,.55,.13,M.cloth,0,1.14,.33,chair,.05);
 box(.74,.025,.015,M.seam,0,.94,.405,chair,.008);
 for(const x of [-.33,.33]){
  rod([x,.73,-.26],[x*1.20,.04,-.34],.025,M.charcoal,chair);
  rod([x,.73,.27],[x*1.20,.04,.40],.025,M.charcoal,chair);
  rod([x,.72,.27],[x,1.19,.34],.021,M.charcoal,chair);
 }
 // Capture every original world placement before removing any ownership edge.
 room.updateMatrixWorld(true);
 const placements = models.map(({id, model}) => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  model.matrixWorld.decompose(position, quaternion, scale);
  let depth = 0;
  for (let parent = model.parent; parent; parent = parent.parent) depth++;
  return {id, model, position: position.toArray(), quaternion: quaternion.toArray(), scale: scale.toArray(), depth};
 });
 // Extract children first: desks, shelves and cable assemblies cannot retain
 // copies of other exported semantic objects. All descendants stay root-local.
 placements.sort((a, b) => b.depth - a.depth);
 for (const entry of placements) {
  const model = entry.model;
  model.removeFromParent();
  model.position.set(0, 0, 0);
  model.quaternion.identity();
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  model.traverse(object => {
   if (!object.isMesh) return;
   object.userData.castShadow = object.castShadow;
   object.userData.receiveShadow = object.receiveShadow;
   const materials = Array.isArray(object.material) ? object.material : [object.material];
   for (const mat of materials) {
    mat.userData.unlit = mat.isMeshBasicMaterial === true;
    mat.userData.toneMapped = mat.toneMapped;
   }
  });
 }
 return placements.map(({id, model, position, quaternion, scale}) => ({id, model, position, quaternion, scale}));
};
