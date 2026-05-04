export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (typeof globalThis.DOMMatrix !== 'undefined') return;

  // pdfjs-dist tries require('@napi-rs/canvas') at module init to get DOMMatrix.
  // On Vercel the native binary may fail to load, leaving DOMMatrix undefined, which
  // causes a module-level ReferenceError before any request handler runs.
  //
  // We polyfill here — inline, no require() — so the global is set before pdfjs-dist
  // is ever imported. Implementation adapted from @napi-rs/canvas geometry.js (MIT).

  const DEGREE_PER_RAD = 180 / Math.PI;
  const RAD_PER_DEGREE = Math.PI / 180;
  const VALUES = Symbol('values');
  const IS_2D  = Symbol('is2D');

  const M11 = 0, M12 = 1, M13 = 2,  M14 = 3;
  const M21 = 4, M22 = 5, M23 = 6,  M24 = 7;
  const M31 = 8, M32 = 9, M33 = 10, M34 = 11;
  const M41 = 12, M42 = 13, M43 = 14, M44 = 15;
  const A = M11, B = M12, C = M21, D = M22, E = M41, F = M42;

  function matMul(a, b) {
    const d = new Float64Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
        d[i * 4 + j] = s;
      }
    return d;
  }

  function parseMatrix(s) {
    const p = s.replace(/matrix\(/, '').split(/,/, 7).map(parseFloat);
    if (p.length !== 6) throw new Error(`Failed to parse ${s}`);
    return [p[0], p[1], 0, 0, p[2], p[3], 0, 0, 0, 0, 1, 0, p[4], p[5], 0, 1];
  }

  function parseMatrix3d(s) {
    const p = s.replace(/matrix3d\(/, '').split(/,/, 17).map(parseFloat);
    if (p.length !== 16) throw new Error(`Failed to parse ${s}`);
    return p;
  }

  function parseTransform(t) {
    const type = t.split(/\(/, 1)[0];
    if (type === 'matrix')   return parseMatrix(t);
    if (type === 'matrix3d') return parseMatrix3d(t);
    throw new Error(`${type} parsing not implemented`);
  }

  const set2 = (m, i, v) => { if (typeof v !== 'number') throw new TypeError('Expected number'); m[VALUES][i] = v; };
  const set3 = (m, i, v) => {
    if (typeof v !== 'number') throw new TypeError('Expected number');
    if (i === M33 || i === M44 ? v !== 1 : v !== 0) m[IS_2D] = false;
    m[VALUES][i] = v;
  };

  const newInst = (vals) => {
    const inst = Object.create(DOMMatrix.prototype);
    inst[IS_2D]  = true;
    inst[VALUES] = vals;
    return inst;
  };

  class DOMPoint {
    constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
    static fromPoint(p) { return new DOMPoint(p.x, p.y, p.z ?? 0, p.w ?? 1); }
    matrixTransform(m) {
      if (m.is2D && this.z === 0 && this.w === 1)
        return new DOMPoint(this.x * m.a + this.y * m.c + m.e, this.x * m.b + this.y * m.d + m.f, 0, 1);
      return new DOMPoint(
        this.x * m.m11 + this.y * m.m21 + this.z * m.m31 + this.w * m.m41,
        this.x * m.m12 + this.y * m.m22 + this.z * m.m32 + this.w * m.m42,
        this.x * m.m13 + this.y * m.m23 + this.z * m.m33 + this.w * m.m43,
        this.x * m.m14 + this.y * m.m24 + this.z * m.m34 + this.w * m.m44,
      );
    }
    toJSON() { return { x: this.x, y: this.y, z: this.z, w: this.w }; }
  }

  class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) { this.x = x; this.y = y; this.width = width; this.height = height; }
    static fromRect(r) { return new DOMRect(r.x, r.y, r.width, r.height); }
    get top()    { return this.y; }
    get left()   { return this.x; }
    get right()  { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height, top: this.top, left: this.left, right: this.right, bottom: this.bottom }; }
  }

  class DOMMatrix {
    constructor(init) {
      this[IS_2D]  = true;
      this[VALUES] = new Float64Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
      if (typeof init === 'string') {
        if (!init) return;
        const tforms = init.split(/\)\s+/, 20).map(parseTransform);
        if (!tforms.length) return;
        let v = tforms[0];
        for (let i = 1; i < tforms.length; i++) v = matMul(tforms[i], v);
        init = v;
      }
      if (!init) return;
      let i = 0;
      if (init.length === 6) {
        set2(this, A, init[i++]); set2(this, B, init[i++]);
        set2(this, C, init[i++]); set2(this, D, init[i++]);
        set2(this, E, init[i++]); set2(this, F, init[i++]);
      } else if (init.length === 16) {
        set2(this, M11, init[i++]); set2(this, M12, init[i++]); set3(this, M13, init[i++]); set3(this, M14, init[i++]);
        set2(this, M21, init[i++]); set2(this, M22, init[i++]); set3(this, M23, init[i++]); set3(this, M24, init[i++]);
        set3(this, M31, init[i++]); set3(this, M32, init[i++]); set3(this, M33, init[i++]); set3(this, M34, init[i++]);
        set2(this, M41, init[i++]); set2(this, M42, init[i++]); set3(this, M43, init[i++]); set3(this, M44, init[i]);
      } else if (init !== undefined) {
        throw new TypeError('Expected string or array.');
      }
    }

    // ── scalar props ────────────────────────────────────────────────────────────
    get m11() { return this[VALUES][M11]; } set m11(v) { set2(this, M11, v); }
    get m12() { return this[VALUES][M12]; } set m12(v) { set2(this, M12, v); }
    get m13() { return this[VALUES][M13]; } set m13(v) { set3(this, M13, v); }
    get m14() { return this[VALUES][M14]; } set m14(v) { set3(this, M14, v); }
    get m21() { return this[VALUES][M21]; } set m21(v) { set2(this, M21, v); }
    get m22() { return this[VALUES][M22]; } set m22(v) { set2(this, M22, v); }
    get m23() { return this[VALUES][M23]; } set m23(v) { set3(this, M23, v); }
    get m24() { return this[VALUES][M24]; } set m24(v) { set3(this, M24, v); }
    get m31() { return this[VALUES][M31]; } set m31(v) { set3(this, M31, v); }
    get m32() { return this[VALUES][M32]; } set m32(v) { set3(this, M32, v); }
    get m33() { return this[VALUES][M33]; } set m33(v) { set3(this, M33, v); }
    get m34() { return this[VALUES][M34]; } set m34(v) { set3(this, M34, v); }
    get m41() { return this[VALUES][M41]; } set m41(v) { set2(this, M41, v); }
    get m42() { return this[VALUES][M42]; } set m42(v) { set2(this, M42, v); }
    get m43() { return this[VALUES][M43]; } set m43(v) { set3(this, M43, v); }
    get m44() { return this[VALUES][M44]; } set m44(v) { set3(this, M44, v); }
    get a() { return this[VALUES][A]; } set a(v) { set2(this, A, v); }
    get b() { return this[VALUES][B]; } set b(v) { set2(this, B, v); }
    get c() { return this[VALUES][C]; } set c(v) { set2(this, C, v); }
    get d() { return this[VALUES][D]; } set d(v) { set2(this, D, v); }
    get e() { return this[VALUES][E]; } set e(v) { set2(this, E, v); }
    get f() { return this[VALUES][F]; } set f(v) { set2(this, F, v); }
    get is2D() { return this[IS_2D]; }
    get isIdentity() {
      const v = this[VALUES];
      return v[M11]===1&&v[M12]===0&&v[M13]===0&&v[M14]===0&&
             v[M21]===0&&v[M22]===1&&v[M23]===0&&v[M24]===0&&
             v[M31]===0&&v[M32]===0&&v[M33]===1&&v[M34]===0&&
             v[M41]===0&&v[M42]===0&&v[M43]===0&&v[M44]===1;
    }

    // ── static constructors ──────────────────────────────────────────────────────
    static fromMatrix(init)      { return new DOMMatrix(init[VALUES]); }
    static fromFloat32Array(a)   { if (!(a instanceof Float32Array)) throw new TypeError('Expected Float32Array'); return new DOMMatrix(a); }
    static fromFloat64Array(a)   { if (!(a instanceof Float64Array)) throw new TypeError('Expected Float64Array'); return new DOMMatrix(a); }

    // ── mutation helpers ─────────────────────────────────────────────────────────
    multiply(o)     { return newInst(this[VALUES]).multiplySelf(o); }
    multiplySelf(o) { this[VALUES] = matMul(o[VALUES], this[VALUES]); if (!o.is2D) this[IS_2D] = false; return this; }
    preMultiplySelf(o) { this[VALUES] = matMul(this[VALUES], o[VALUES]); if (!o.is2D) this[IS_2D] = false; return this; }

    translate(tx, ty, tz)    { return newInst(this[VALUES]).translateSelf(tx, ty, tz); }
    translateSelf(tx=0,ty=0,tz=0) {
      this[VALUES] = matMul([1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1], this[VALUES]);
      if (tz !== 0) this[IS_2D] = false;
      return this;
    }

    scale(sx,sy,sz,ox,oy,oz)  { return newInst(this[VALUES]).scaleSelf(sx,sy,sz,ox,oy,oz); }
    scale3d(s,ox,oy,oz)       { return newInst(this[VALUES]).scaleSelf(s,s,s,ox,oy,oz); }
    scaleSelf(sx,sy,sz,ox=0,oy=0,oz=0) {
      this.translateSelf(ox,oy,oz);
      if (typeof sx !== 'number') sx = 1;
      if (typeof sy !== 'number') sy = sx;
      if (typeof sz !== 'number') sz = 1;
      this[VALUES] = matMul([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1], this[VALUES]);
      this.translateSelf(-ox,-oy,-oz);
      if (sz !== 1 || oz !== 0) this[IS_2D] = false;
      return this;
    }

    rotate(rx,ry,rz)         { return newInst(this[VALUES]).rotateSelf(rx,ry,rz); }
    rotateSelf(rx,ry,rz) {
      if (ry === undefined && rz === undefined) { rz = rx; rx = ry = 0; }
      if (typeof ry !== 'number') ry = 0;
      if (typeof rz !== 'number') rz = 0;
      if (rx !== 0 || ry !== 0) this[IS_2D] = false;
      rx *= RAD_PER_DEGREE; ry *= RAD_PER_DEGREE; rz *= RAD_PER_DEGREE;
      let c = Math.cos(rz), s = Math.sin(rz);
      this[VALUES] = matMul([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1], this[VALUES]);
      c = Math.cos(ry); s = Math.sin(ry);
      this[VALUES] = matMul([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1], this[VALUES]);
      c = Math.cos(rx); s = Math.sin(rx);
      this[VALUES] = matMul([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1], this[VALUES]);
      return this;
    }
    rotateFromVector(x,y)    { return newInst(this[VALUES]).rotateFromVectorSelf(x,y); }
    rotateFromVectorSelf(x=0,y=0) { return this.rotateSelf((x===0&&y===0)?0:Math.atan2(y,x)*DEGREE_PER_RAD); }
    rotateAxisAngle(x,y,z,a) { return newInst(this[VALUES]).rotateAxisAngleSelf(x,y,z,a); }
    rotateAxisAngleSelf(x=0,y=0,z=0,angle=0) {
      const len = Math.sqrt(x*x+y*y+z*z);
      if (!len) return this;
      if (len !== 1) { x/=len; y/=len; z/=len; }
      angle *= RAD_PER_DEGREE;
      const c=Math.cos(angle),s=Math.sin(angle),t=1-c,tx=t*x,ty=t*y;
      this[VALUES] = matMul([tx*x+c,tx*y+s*z,tx*z-s*y,0, tx*y-s*z,ty*y+c,ty*z+s*x,0, tx*z+s*y,ty*z-s*x,t*z*z+c,0, 0,0,0,1], this[VALUES]);
      if (x !== 0 || y !== 0) this[IS_2D] = false;
      return this;
    }

    skewX(sx)    { return newInst(this[VALUES]).skewXSelf(sx); }
    skewXSelf(sx){ if (typeof sx !== 'number') return this; this[VALUES]=matMul([1,0,0,0, Math.tan(sx*RAD_PER_DEGREE),1,0,0, 0,0,1,0, 0,0,0,1],this[VALUES]); return this; }
    skewY(sy)    { return newInst(this[VALUES]).skewYSelf(sy); }
    skewYSelf(sy){ if (typeof sy !== 'number') return this; this[VALUES]=matMul([1,Math.tan(sy*RAD_PER_DEGREE),0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],this[VALUES]); return this; }

    flipX()  { return newInst(matMul([-1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1], this[VALUES])); }
    flipY()  { return newInst(matMul([1,0,0,0, 0,-1,0,0, 0,0,1,0, 0,0,0,1], this[VALUES])); }

    inverse()    { return newInst(this[VALUES].slice()).invertSelf(); }
    invertSelf() {
      if (!this[IS_2D]) throw new Error('3D matrix inversion not implemented.');
      const v = this[VALUES], det = v[A]*v[D] - v[B]*v[C];
      if (det === 0) { this[IS_2D]=false; this[VALUES]=[NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN]; return this; }
      this.a=(v[D]/det); this.b=(-v[B]/det); this.c=(-v[C]/det); this.d=(v[A]/det);
      this.e=((v[C]*v[F]-v[D]*v[E])/det); this.f=((v[B]*v[E]-v[A]*v[F])/det);
      return this;
    }

    setMatrixValue(t) { const tmp=new DOMMatrix(t); this[VALUES]=tmp[VALUES]; this[IS_2D]=tmp[IS_2D]; return this; }

    transformPoint(p) {
      const x=p.x||0,y=p.y||0,z=p.z||0,w=p.w||1,v=this[VALUES];
      return new DOMPoint(
        v[M11]*x+v[M21]*y+v[M31]*z+v[M41]*w,
        v[M12]*x+v[M22]*y+v[M32]*z+v[M42]*w,
        v[M13]*x+v[M23]*y+v[M33]*z+v[M43]*w,
        v[M14]*x+v[M24]*y+v[M34]*z+v[M44]*w,
      );
    }

    toFloat32Array() { return Float32Array.from(this[VALUES]); }
    toFloat64Array() { return this[VALUES].slice(0); }
    toString() {
      return this.is2D
        ? `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`
        : `matrix3d(${Array.from(this[VALUES]).join(', ')})`;
    }
    toJSON() {
      return { a:this.a,b:this.b,c:this.c,d:this.d,e:this.e,f:this.f,
               m11:this.m11,m12:this.m12,m13:this.m13,m14:this.m14,
               m21:this.m21,m22:this.m22,m23:this.m23,m24:this.m24,
               m31:this.m31,m32:this.m32,m33:this.m33,m34:this.m34,
               m41:this.m41,m42:this.m42,m43:this.m43,m44:this.m44,
               is2D:this.is2D,isIdentity:this.isIdentity };
    }
  }

  // Make all matrix props enumerable (matches spec)
  for (const k of ['a','b','c','d','e','f','m11','m12','m13','m14','m21','m22','m23','m24',
                    'm31','m32','m33','m34','m41','m42','m43','m44','is2D','isIdentity']) {
    const d = Object.getOwnPropertyDescriptor(DOMMatrix.prototype, k);
    if (d) { d.enumerable = true; Object.defineProperty(DOMMatrix.prototype, k, d); }
  }

  globalThis.DOMMatrix = DOMMatrix;
  globalThis.DOMPoint  = DOMPoint;
  globalThis.DOMRect   = DOMRect;
  console.log('[instrumentation] DOMMatrix polyfilled (inline)');
}
