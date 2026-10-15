
import {
  Effect,
  Scene,
  ShaderMaterial,
  AbstractMesh,
  Vector2,
  Vector3,
} from "@babylonjs/core";

// VERTEX SHADER
Effect.ShadersStore["sanctuaryAbyssVertexShader"] = `
precision highp float;

attribute vec3 position;
attribute vec2 uv;

uniform mat4 worldViewProjection;

varying vec2 vUV;

void main() {
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

// FRAGMENT SHADER
Effect.ShadersStore["sanctuaryAbyssFragmentShader"] = `
precision highp float;

varying vec2 vUV;

uniform float uTime;
uniform float uFog;
uniform float uGlow;
uniform float uGeometryMix;
uniform vec2 uParallax;

float hash(vec2 p) {
    return fract(
        sin(dot(p, vec2(127.1, 311.7))) * 43758.5453
    );
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f*f*(3.0-2.0*f);

    return mix(
        mix(hash(i), hash(i+vec2(1.0,0.0)),f.x),
        mix(hash(i+vec2(0.0,1.0)),
            hash(i+vec2(1.0,1.0)),f.x),
        f.y
    );
}

float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;

    for (int i=0; i<4; i++) {
        value += amp * noise(p);
        p = p*2.03 + vec2(13.1,7.7);
        amp *= 0.5;
    }

    return value;
}

float boxMask(vec2 p, vec2 center, vec2 halfSize) {
    vec2 d = abs(p-center)-halfSize;
    return 1.0-smoothstep(
        0.0,0.005,max(d.x,d.y)
    );
}

// Torres monumentales flotantes
float tower(
    vec2 p,
    float x,
    float bottom,
    float top,
    float width
) {
    float mid = (bottom+top)*0.5;
    float height = (top-bottom)*0.5;

    float body = boxMask(
        p,vec2(x,mid),vec2(width,height)
    );

    float crown = boxMask(
        p,vec2(x,top+0.012),
        vec2(width*0.82,0.022)
    );

    float buttress = boxMask(
        p,vec2(x+width*0.8,mid-0.05),
        vec2(width*0.23,height*0.6)
    );

    return max(body,max(crown,buttress));
}

// Figuras humanas suspendidas
float apparition(vec2 p, vec2 center, float size) {
    vec2 q = (p-center)/size;

    float head = 1.0-smoothstep(
        0.065,0.085,
        length(q-vec2(0.0,0.16))
    );

    float vertical =
        smoothstep(-0.33,-0.29,q.y) *
        (1.0-smoothstep(0.07,0.12,q.y));

    float width = mix(
        0.12,0.055,
        clamp((q.y+0.33)/0.45,0.0,1.0)
    );

    float robe = vertical *
        (1.0-smoothstep(
            width,width+0.015,abs(q.x)
        ));

    return max(head,robe);
}

void main() {
    vec2 uv = vUV;
    vec2 p = vec2(uv.x-0.5,uv.y);
    float t = uTime;

    // 1. VACÍO Y NUBES
    vec3 color = mix(
        vec3(0.012,0.015,0.024),
        vec3(0.110,0.125,0.145),
        pow(1.0-p.y,1.4)
    );

    float clouds = fbm(vec2(
        p.x*4.5 + sin(p.y*3.0)*0.15,
        p.y*2.8-t*0.026
    ));

    color += vec3(0.065,0.080,0.098) *
        smoothstep(0.35,0.75,clouds) *
        uFog;

    // 2. GRIETA DE LUZ INFINITA
    float slitX = 0.02 +
        0.003*sin(p.y*7.0+t*0.17);

    float dx = abs(p.x-slitX);

    float core = exp(-dx*400.0);
    float innerGlow = exp(-dx*55.0);
    float outerGlow = exp(-dx*12.0);

    float pulse = 0.92 +
        0.08*sin(t*0.75);

    color += vec3(0.72,0.84,1.0) *
        (core*1.5 +
         innerGlow*0.37 +
         outerGlow*0.10) *
        pulse*uGlow;

    // 3. ARQUITECTURA LEJANA
    vec2 farP = p+uParallax*0.2;

    float farTowers = 0.0;

    farTowers = max(
        farTowers,
        tower(farP,-0.31,0.16,0.83,0.047)
    );
    farTowers = max(
        farTowers,
        tower(farP,0.28,0.28,0.94,0.055)
    );
    farTowers = max(
        farTowers,
        tower(farP,-0.07,0.42,0.88,0.025)
    );

    color = mix(
        color,vec3(0.047,0.055,0.070),
        farTowers*0.76*uGeometryMix
    );

    // 4. ARCOS IMPOSIBLES
    vec2 arcP = p+uParallax*0.45 -
        vec2(0.035,0.64);

    float radius = length(vec2(
        arcP.x,arcP.y*1.30
    ));

    float arch =
        1.0-smoothstep(
            0.012,0.027,abs(radius-0.29)
        );

    arch *= smoothstep(-0.08,0.04,arcP.y);

    color = mix(
        color,vec3(0.068,0.071,0.081),
        arch*0.85*uGeometryMix
    );

    // 5. NIEBLA INTERMEDIA
    float mist = fbm(vec2(
        p.x*3.5-t*0.020,
        p.y*3.0+t*0.035
    ));

    float mistAmount =
        smoothstep(0.36,0.75,mist) *
        (0.25+0.55*(1.0-p.y)) *
        (1.0-smoothstep(0.12,0.34,p.y)) *
        uFog;

    color = mix(
        color,
        vec3(0.115,0.130,0.155),
        clamp(mistAmount*0.62,0.0,0.75)
    );

    // 6. ARQUITECTURA CERCANA
    vec2 nearP = p+uParallax*0.8;

    float structures = 0.0;

    structures = max(
        structures,
        tower(nearP,-0.42,0.03,0.70,0.060)
    );
    structures = max(
        structures,
        tower(nearP,0.39,0.08,0.65,0.078)
    );
    structures = max(
        structures,
        tower(nearP,0.18,0.01,0.48,0.042)
    );

    color = mix(
        color,vec3(0.023,0.028,0.039),
        structures*0.96*uGeometryMix
    );

    // Ventanas profundas
    float windows = 0.0;

    windows += boxMask(
        nearP,vec2(0.18,0.28),
        vec2(0.004,0.060)
    );

    windows += boxMask(
        nearP,vec2(-0.42,0.46),
        vec2(0.005,0.045)
    );

    color += vec3(0.16,0.025,0.023) *
        windows*structures*uGeometryMix;

    // 7. FRAGMENTOS FLOTANTES
    for (int i=0; i<15; i++) {
        float fi = float(i);

        vec2 center = vec2(
            mix(-0.43,0.43,hash(vec2(fi,2.0))),
            mix(0.12,0.94,hash(vec2(fi,5.0)))
        );

        center += vec2(
            sin(t*0.21+fi*1.7)*0.004,
            cos(t*0.17+fi*1.3)*0.008
        );

        float size = mix(
            0.005,0.021,
            hash(vec2(fi,8.0))
        );

        vec2 fragmentP = p +
            uParallax*(0.3+0.04*fi);

        float piece = boxMask(
            fragmentP,center,
            vec2(size*0.6,size*1.8)
        );

        color = mix(
            color,vec3(0.028,0.033,0.047),
            piece*0.90*uGeometryMix
        );
    }

    // 8. ALMAS SUSPENDIDAS
    vec2 ghost1 = vec2(
        -0.17+0.003*sin(t*0.35),0.36
    );

    vec2 ghost2 = vec2(
        0.19+0.004*sin(t*0.27+2.0),0.52
    );

    float figures = max(
        apparition(p+uParallax*0.65,ghost1,0.32),
        apparition(p+uParallax*0.45,ghost2,0.23)
    );

    color = mix(
        color,vec3(0.018,0.022,0.033),
        figures*0.92*uGeometryMix
    );

    // 9. POLVO SUSPENDIDO
    for (int i=0; i<12; i++) {
        float fi = float(i);
        vec2 dust = vec2(
            hash(vec2(fi,11.0)),
            fract(hash(vec2(fi,13.0))+t*0.006)
        );

        float d = length(uv-dust);

        color += vec3(0.16,0.19,0.24) *
            (1.0-smoothstep(
                0.001,0.004,d
            ))*0.35;
    }

    // 10. OSCURECER LOS BORDES
    float edge = min(
        uv.x,1.0-uv.x
    );

    float vignette =
        0.25+0.75*smoothstep(0.0,0.12,edge);

    vignette *=
        0.7+0.3*smoothstep(0.0,0.09,uv.y);

    color *= vignette;

    // Fisura rojiza próxima al marco
    float rim = exp(-edge*145.0);

    color += vec3(0.10,0.009,0.012)*rim;

    gl_FragColor = vec4(
        clamp(color,0.0,1.0),1.0
    );
}
`;

export function createSanctuaryAbyssPortal(
  scene: Scene,
  surface: AbstractMesh
) {
  const material = new ShaderMaterial(
    "SanctuaryAbyssPortal",
    scene,
    {
      vertex: "sanctuaryAbyss",
      fragment: "sanctuaryAbyss",
    },
    {
      attributes: ["position", "uv"],
      uniforms: [
        "worldViewProjection",
        "uTime",
        "uFog",
        "uGlow",
        "uGeometryMix",
        "uParallax",
      ],
    }
  );

  material.backFaceCulling = false;
  material.fogEnabled = false;

  material.setFloat("uTime", 0);
  material.setFloat("uFog", 1.0);
  material.setFloat("uGlow", 1.1);
  material.setFloat("uGeometryMix", 1.0);
  material.setVector2(
    "uParallax",
    new Vector2(0, 0)
  );

  surface.material = material;

  let elapsed = 0;
  // The gate surface is static; its inverse transform and vectors can be reused.
  const inverseSurfaceWorld = surface.getWorldMatrix().clone().invert();
  const localCamera = Vector3.Zero();
  const parallax = Vector2.Zero();

  const observer = scene.onBeforeRenderObservable.add(
    () => {
      elapsed +=
        scene.getEngine().getDeltaTime() / 1000;

      material.setFloat("uTime", elapsed);

      // Paralaje sutil para simular profundidad
      if (scene.activeCamera) {
        Vector3.TransformCoordinatesToRef(
          scene.activeCamera.globalPosition,
          inverseSurfaceWorld,
          localCamera
        );

        parallax.set(
          Math.max(-0.06, Math.min(0.06, localCamera.x * 0.025)),
          Math.max(-0.02, Math.min(0.02, localCamera.y * 0.005))
        );
        material.setVector2("uParallax", parallax);
      }
    }
  );

  return {
    material,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      material.dispose();
    },
  };
}
