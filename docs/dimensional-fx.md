# Dimensional FX — integración oficial propuesta para Bosque Babylon

**Origen:** Dimensional FX Lab v0.13 (y correcciones visuales de Rina v0.10). Todo el GLSL incluido es una adaptación independiente; se conservan las referencias a los Shadertoy que inspiraron cada efecto. No se reproduce su código original.

**Alcance:** biblioteca de VFX reutilizable, con importación diferida. **No** se ha activado ningún efecto en escenas, HUD ni cinemáticas del juego; por lo tanto tampoco cambia cordura, vida, enemigos, nivel o inventario.

## Instalación

Copiar `src/vfx/dimensional/` de este paquete a `src/vfx/dimensional/` del repositorio. No sobrescribir otros archivos del juego. Mantener las extensiones `.glsl`: Vite las importa con `?raw`.

Comprobar desde el repositorio:

```bash
npm run build
```

Para probar un efecto basta importarlo desde `src/vfx/dimensional`. Las funciones son **asíncronas** porque cada fuente GLSL se importa bajo demanda. Usar los controladores `dispose()` al salir de un nivel. No hay módulos globales con efectos activos al importar el catálogo.

## Ejemplos (no se ejecutan automáticamente)

### Pantallas de Rina

```ts
import { createDimensionalSurface } from '../../vfx/dimensional';

const fx = await createDimensionalSurface(scene, 'lX2GzD', {
  params: {
    gridSpeed: 2.3,
    sunGlow: 1.5,
    sunTopColor: '#fff5bc',
    sunBottomColor: '#ffb0bd',
    sunHaloColor: '#ff19b9',
  },
});
// Aplicar a pantallas con UV correctas en el escenario real:
ledScreen.material = fx.value;
// Antes de eliminar la escena / al cambiar de nivel:
ledScreen.material = null;
fx.dispose();
```

### Ojo del Lago: conexión 3D del jugador al ojo

```ts
import { WarpConnectionFX } from '../../vfx/dimensional';
const eyeGaze = new WarpConnectionFX(scene, {radius: .8, intensity: .7});
eyeGaze.setEndpoints(eyeWorldPosition, playerWorldPosition);
// Llamar otra vez cuando cambien las posiciones. La activación/oclusiones
// y el drenaje de cordura siguen perteneciendo al sistema actual del jefe.
// eyeGaze.setVisible(false) al romper línea de visión.
eyeGaze.dispose();
```

### Oscuridad manual / automática

```ts
const darkness = await createDimensionalSurface(scene, '4XVBzK', {
  params: {
    darknessAperture: {
      playback: 'manual', manualOpen: 0.7, x: .45, y: .5,
      radius: .6, softness: .38,
      // Los demás parámetros se completan con defaults.
    },
  },
});
quad.material = darkness.value;
// Para abrir o cerrar por evento:
darkness.params.darknessAperture.manualOpen = .9;
quad.material = null;
darkness.dispose();
```

### Crecimiento sobre GLB sin destruir sus materiales originales

```ts
const projection = await createDimensionalProjection(scene, 'ldK3RW', glb.meshes, {
  params:{branchWidth: .35, branchDensity: 1.8, growthSpread: .8, progress: .0},
});
projection.update({progress:.7});
// Restaura los materiales de todos los meshes al salir:
projection.dispose();
```

### Texto como tinta viva

```ts
import { RorschachTextFX, INK_PRESETS } from '../../vfx/dimensional';
const note = new RorschachTextFX(scene, {settings: INK_PRESETS.note});
note.setContent('No mires atrás.', 'Nota sin firma');
note.revealCharacters(12);
// En el futuro: integrar al inspector de notas (actualmente usa imágenes PNG).
note.dispose();
```

### Influencia etérea sobre un personaje con rig

```ts
import { EtherealMeshFX } from '../../vfx/dimensional';
const ethereal = new EtherealMeshFX(scene, glb.meshes, {dissolve:.25, edgeGlow:3});
ethereal.update({dissolve:.6});
ethereal.dispose();
```

### Postproceso de percepción

```ts
const distortion = await createDimensionalPostProcess(scene, camera, '4l2GW1', {
  resolutionRatio:.5,
  params:{intensity:.3},
});
distortion.update({intensity:.8});
distortion.dispose();
```

## Qué contiene y cómo funciona

- **17 shaders** sin cambiar las versiones aprobadas por el usuario, incluyendo la v0.13 del efecto `4XVBzK` y la versión optimizada de `4t2cR1`.
- **2 fuentes heredadas**: cosmic v0.10 y darkness v0.12, con cambio explícito de variante.
- **3 sistemas especiales**: `WarpConnectionFX`, `EtherealMeshFX`, `RorschachTextFX`.
- **Registro tipado** de 20 recursos (17+3), con enlace a Shadertoy, nivel sugerido y estado de aprobación.
- **Importación lazy** del GLSL de los 17 shaders, evitando ejecutar efectos no usados.
- **Controladores** de apertura/cierre independientes y sin deriva temporal.
- **Ciclo de vida** por instancia (`dispose`) para liberar recursos y observadores.

## Precauciones

- Los shaders `quad` son efectos 2D/2.5D: no generan automáticamente arquitectura navegable ni colliders.
- Las proyecciones sobre GLB son por UV; las islas UV pueden tener discontinuidades. El plugin etéreo requiere materiales PBR, y los materiales no PBR se conservan sin el efecto.
- El modo `postprocess` necesita una cámara real y su posición dentro de la cadena de postprocesos debe decidirse nivel por nivel.
- La composición de Rina debe aplicarse a pantallas con UV correctas y proporción 16:9.
- Rorschach Text usa una textura dinámica y recalcula el campo de distancia cuando cambia el contenido, no cada frame; se recomienda mostrar un solo texto vivo a la vez en móvil.
- El paquete se compiló con la instalación local de Babylon 9 mediante `npm run build` y se probó en una escena WebGL2 aislada. La integración visual en niveles reales sigue pendiente.
- Mantener las 16 implementaciones aprobadas sin alterar. El material del sol `lX2GzD` es una adaptación pendiente de aprobación final; no cambiarlo silenciosamente.

## Procedencia y licencias

Las URLs y títulos de Shadertoy son referencias de inspiración visual, no una licencia sobre el shader original. La biblioteca utiliza código independiente generado y probado en el laboratorio. Antes de distribuir el juego conviene revisar individualmente las licencias de los originales si se pretende reutilizar código, texturas o música de terceros. En este parche no se ha incorporado código GLSL ajeno de Shadertoy.

## Verificación local

Desde la raíz del repositorio:

```bash
node scripts/verify-dimensional-package.mjs
npm run build
npm run dev
# En otra terminal:
node scripts/verify-dimensional-browser.mjs
```

También se puede abrir `http://localhost:5173/dev/dimensional-smoke.html` para ver el resultado de cada comprobación. Esta página está aislada del juego y no activa efectos en ningún nivel.

La prueba comprueba el catálogo, las 16 aprobaciones previas y los identificadores de Shadertoy; compila las 17 fuentes de catálogo en WebGL2; compara `4t2cR1` en eco/equilibrado/alta/original y `4XVBzK` en controlado/original; ejercita apertura manual sin deriva; crea y libera superficies, postprocesos y proyección. También mueve los extremos de `WarpConnectionFX`, edita el contenido de `RorschachTextFX` y aplica `EtherealMeshFX` al GLB animado `public/assets/models/enemies/shadow_grabber.glb`, restaurando el material PBR al liberar el efecto.

En la máquina de integración, el navegador informó `ANGLE / NVIDIA GeForce RTX 3090 / Direct3D11` y alrededor de 60 FPS durante la prueba breve. Este valor solo confirma ejecución local; no es una medición de rendimiento por efecto ni en móvil. El GLB de prueba contiene rig, 7 animaciones y material PBR. Las fuentes GLSL se preservan según `dimensional-source-manifest.json`; los adaptadores TypeScript/JavaScript se ajustaron para Babylon 9, importación diferida y limpieza de registros.
