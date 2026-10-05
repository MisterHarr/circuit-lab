(() => {
  'use strict';
  const BUILD = 'CL-P1-ACCESS-v0.1';
  const noScript = document.getElementById('no-script');
  const detail = document.getElementById('detail');
  const scriptStatus = document.getElementById('script-status');
  const webglStatus = document.getElementById('webgl-status');
  const modelStatus = document.getElementById('model-status');
  const canvas = document.getElementById('gl-canvas');
  const resetButton = document.getElementById('reset-view');

  function updateSummary() {
    const s = scriptStatus.textContent;
    const w = webglStatus.textContent;
    const m = modelStatus.textContent;
    if (s === 'ERR-SCRIPT') return;
    if (w === 'OK-WEBGL' && m === 'OK-MODEL') {
      detail.textContent = `All core checks passed · ${BUILD} · WebGL active and local GLB fetched/parsed.`;
    } else if (w === 'ERR-WEBGL' && m === 'OK-MODEL') {
      detail.textContent = `ERR-WEBGL · local GLB still fetched/parsed successfully · ${BUILD}`;
    } else if (w === 'OK-WEBGL' && m === 'ERR-MODEL-FETCH') {
      detail.textContent = `ERR-MODEL-FETCH · WebGL is working but the local GLB path failed · ${BUILD}`;
    }
  }

  window.addEventListener('error', (event) => {
    scriptStatus.textContent = 'ERR-SCRIPT';
    detail.textContent = `ERR-SCRIPT · ${event.message || 'Uncaught application error'}`;
  });

  scriptStatus.textContent = 'OK-SCRIPT';
  noScript.classList.add('hidden');

  async function checkGLB() {
    try {
      const response = await fetch('./models/access-test-cube.glb', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength < 20) throw new Error('GLB too small');
      const view = new DataView(buffer);
      const magic = view.getUint32(0, true);
      const version = view.getUint32(4, true);
      const declared = view.getUint32(8, true);
      if (magic !== 0x46546c67) throw new Error('Invalid GLB magic');
      if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);
      if (declared !== buffer.byteLength) throw new Error('GLB length mismatch');
      const jsonLength = view.getUint32(12, true);
      const jsonType = view.getUint32(16, true);
      if (jsonType !== 0x4E4F534A) throw new Error('Missing GLB JSON chunk');
      const jsonBytes = new Uint8Array(buffer, 20, jsonLength);
      const json = JSON.parse(new TextDecoder().decode(jsonBytes).replace(/\u0000+$/,''));
      if (!json.asset || json.asset.version !== '2.0') throw new Error('Invalid glTF asset metadata');
      modelStatus.textContent = 'OK-MODEL';
    } catch (err) {
      modelStatus.textContent = 'ERR-MODEL-FETCH';
      detail.textContent = `ERR-MODEL-FETCH · ${err.message}`;
    } finally {
      updateSummary();
    }
  }
  checkGLB();

  let gl;
  try {
    gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL context unavailable');
    webglStatus.textContent = 'OK-WEBGL';
  } catch (err) {
    webglStatus.textContent = 'ERR-WEBGL';
    detail.textContent = `ERR-WEBGL · ${err.message}`;
    updateSummary();
    return;
  }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aColor;
    uniform mat4 uMVP;
    varying vec3 vColor;
    void main(){ vColor=aColor; gl_Position=uMVP*vec4(aPosition,1.0); }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec3 vColor;
    void main(){ gl_FragColor=vec4(vColor,1.0); }
  `;

  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'Shader compile failed');
    return s;
  }

  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
  gl.useProgram(program);

  const vertices = new Float32Array([
    -1,-1,-1, .25,.50,.90,  1,-1,-1, .25,.50,.90,  1,1,-1, .45,.70,1.0, -1,1,-1, .45,.70,1.0,
    -1,-1, 1, .90,.55,.25,  1,-1, 1, .90,.55,.25,  1,1, 1, 1.0,.75,.40, -1,1, 1, 1.0,.75,.40
  ]);
  const indices = new Uint16Array([0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4]);

  const vb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const ib = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const pos = gl.getAttribLocation(program, 'aPosition');
  const color = gl.getAttribLocation(program, 'aColor');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(color);
  gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
  const mvpLoc = gl.getUniformLocation(program, 'uMVP');

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let r=0;r<4;r++) for (let c=0;c<4;c++) out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3];
    return out;
  }
  function perspective(fov, aspect, near, far) {
    const f=1/Math.tan(fov/2), nf=1/(near-far);
    return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);
  }
  function rotX(a){ const c=Math.cos(a),s=Math.sin(a); return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1]); }
  function rotY(a){ const c=Math.cos(a),s=Math.sin(a); return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1]); }
  function translate(z){ return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,z,1]); }

  let rx=-0.35, ry=0.6;
  function draw() {
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.floor(canvas.clientWidth*dpr));
    const h=Math.max(1,Math.floor(canvas.clientHeight*dpr));
    if (canvas.width!==w || canvas.height!==h) { canvas.width=w; canvas.height=h; }
    gl.viewport(0,0,w,h);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(.93,.95,.98,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    const p=perspective(Math.PI/4,w/h,.1,100);
    const view=translate(-5);
    const model=multiply(rotY(ry),rotX(rx));
    gl.uniformMatrix4fv(mvpLoc,false,multiply(p,multiply(view,model)));
    gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
  }
  function reset(){ rx=-0.35; ry=0.6; draw(); }
  resetButton.addEventListener('click', reset);

  let dragging=false,lastX=0,lastY=0;
  canvas.addEventListener('pointerdown',(e)=>{ dragging=true; lastX=e.clientX; lastY=e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove',(e)=>{ if(!dragging)return; ry+=(e.clientX-lastX)*0.012; rx+=(e.clientY-lastY)*0.012; lastX=e.clientX; lastY=e.clientY; draw(); });
  canvas.addEventListener('pointerup',()=>{ dragging=false; });
  canvas.addEventListener('pointercancel',()=>{ dragging=false; });
  window.addEventListener('resize',draw);
  draw();
  updateSummary();
})();
