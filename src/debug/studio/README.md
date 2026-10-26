# Animation Studio V2

Editor de desarrollo en `http://localhost:5173/animation-studio.html` con `npm run dev`. La página es exclusiva del entorno de desarrollo.

## Corregir la foto de los fans de Rina

1. Cargar Fan 01–05 y elegir una variante con rig: original, cercano cuando existe o LOD1 animado. Los LOD2 son estáticos y no admiten edición de huesos.
2. En **Animación procedural**, elegir **Rina · foto con celular**. **Repetir foto** muestra la acción actual del juego.
3. Pulsar **Convertir foto en keyframes editables**. El estudio toma 30 muestras durante 5,8 segundos, calcula offsets de huesos respecto de una pose fija del clip base y adjunta el celular real a `RightHand`. El tamaño se ajusta a la escala del fan; en Fan 01 mide aproximadamente 24 cm.
4. Usar **4 vistas** para ver perspectiva, frente, costado y manos desde el público al mismo tiempo. Esta última permite comprobar que la pantalla queda entre los dedos; la vista frontal muestra la cámara y el flash hacia Rina. La primera vista se puede orbitar. **1 vista** devuelve el visor completo.
5. Elegir un instante en la línea de tiempo. **Mover mano derecha/izquierda** crea un objetivo que puede arrastrarse con las flechas del visor o ajustarse con XYZ; **Aplicar posición de la mano** resuelve hombro y codo. Después seleccionar muñeca, falanges o celular para rotarlos y moverlos de forma individual. **Dedos derechos/izquierdos** filtra la lista de huesos.
6. Con **Auto-key** activado, los cambios de huesos, objetivos y accesorio se guardan en el instante actual. **Capturar keyframe** graba la pose manualmente. Reproducir y revisar varios instantes, incluidos el inicio, el disparo y la bajada de brazos. **Ocultar controles 3D** despeja el visor para inspeccionar el resultado.
7. Pulsar **Analizar animación**. El informe recorre los keyframes y marca saltos de articulaciones, tamaño, inclinación y orientación de la pantalla, altura respecto de la cabeza, distancia de los dedos al celular y si ambas manos tocan el mismo lado. Cada observación lleva al instante correspondiente; **Exportar diagnóstico** guarda el informe JSON.
8. Guardar `*.studio.json` para seguir editando. Exportar `*.runtime.json` para integrar huesos y accesorio en el juego, o `*.procedural.json` si solo se necesitan huesos.

La pantalla del celular debe mirar al fan; la cámara y el flash, a Rina. Ambas manos deben sujetar los bordes con los dedos, delante del rostro y sin doblar la muñeca de manera extrema. La guía en el inspector recuerda ese orden de ajuste. La conversión copia la pose actual del juego para facilitar su corrección; no sustituye automáticamente la acción de Rina. La integración del JSON exportado debe hacerse después de revisar el resultado.

La automatización usa el mismo visor y el mismo analizador, con capturas simultáneas de las cuatro vistas. Con el servidor de desarrollo activo, ejecutar `node scripts/audit-animation-studio.mjs --preset fan_01 --out .studio-audit --strict --closeups`. El comando genera `*.audit.json`, capturas de las cuatro vistas y acercamientos desde el escenario, el público, el costado y dos ángulos oblicuos. `--closeup-radius 0.65` ajusta la distancia de cámara en metros. `--strict` devuelve un código de error si encuentra observaciones. Se pueden cambiar `--preset fan_02` a `fan_05`, `--variant lod1|source|near`, `--action rina-photo|boss-pickup|boss-attack` y `--times 0.6,1.2,2,3.5`.

Desde la consola de desarrollo, `__animationStudioDebug.focusPhone("audience", 0.65)` centra el celular y ajusta el zoom. `__animationStudioDebug.orbit(0.4, -0.1, 0.8)` gira la cámara 0,4 radianes en horizontal, -0,1 en vertical y acerca un 20 %. Se puede llamar entre capturas automáticas para inspeccionar una intersección concreta. El informe incluye la distancia de las puntas del pulgar y el índice y la abertura entre ambos; no evalúa todas las intersecciones de malla, que requieren revisión visual.

El JSON de sesión no incluye los bytes de los GLB. Al reabrir, cargar el modelo correspondiente y volver a importar `Smartphone_RinaReady.glb`; hasta entonces se muestra un proxy amarillo. Cambiar de LOD comienza una sesión nueva, por lo que conviene guardar antes.

El estudio también carga las capas procedurales de recoger y atacar del Hermano Mayor como keyframes editables. El hacha y sus interacciones del nivel no se reproducen en el visor. Los materiales importados se fuerzan a opacos solo dentro del estudio.

## Verificación

- `npm run build` compila TypeScript y Vite.
- `node scripts/verify-animation-studio-browser.mjs` comprueba carga de modelos y LOD, foto en vivo, conversión a 30 keyframes, cuatro vistas, escala del celular, edición y guardado de brazo y dedo, materiales opacos, acciones del jefe y exportación/reimportación JSON.
