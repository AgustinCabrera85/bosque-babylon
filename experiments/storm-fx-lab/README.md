# Storm FX Lab

Laboratorio independiente de las escenas del juego. Iniciar con `npm run dev` y abrir
`http://localhost:5173/experiments/storm-fx-lab/`. El build de Vite también genera
`dist/experiments/storm-fx-lab/index.html`.

`LGT_01` carga los cuatro archivos aprobados de la demo v1 sin modificarlos. El botón
**Preset v1 aprobado** restaura crecimiento 0,14 s, emisión 2,5, luz 10,6, halo y
PointLights activos, bloom apagado y disparos automáticos. Estos valores son para
comparación en el laboratorio; la exposición de los niveles del juego es distinta.

## Estado del arte

| Variante | Geometría | Estado | Archivos requeridos en `public/assets/fx/storm/lightning/` |
| --- | --- | --- | --- |
| LGT_01 | `vertical_classic` | Lista | `lgt_01_vertical_classic/lightning-{bolt,growth,halo}.png`, `lightning-head-path.json` |
| LGT_02 | `forked_crown` | Arte pendiente | `lgt_02_forked_crown/lgt_02_forked_crown_{bolt,growth,halo}.png`, `lgt_02_forked_crown_head-path.json` |
| LGT_03 | `needle_strike` | Arte pendiente | `lgt_03_needle_strike/lgt_03_needle_strike_{bolt,growth,halo}.png`, `lgt_03_needle_strike_head-path.json` |
| LGT_04 | `oblique_arc` | Arte pendiente | `lgt_04_oblique_arc/lgt_04_oblique_arc_{bolt,growth,halo}.png`, `lgt_04_oblique_arc_head-path.json` |

Las nubes `CLD_01` y `CLD_02` usan siluetas procedurales temporales; aún faltan sus
dos ilustraciones finales. No se simula `cloud_to_cloud` con el arte de `LGT_01`.
Cada rayo es un plano 2D, por lo que la geometría se ve plana al orbitar la cámara.

Para incorporar una nueva geometría, dibujar un PNG RGBA completo y generar sus
mapas con Python (Pillow, numpy, scipy y scikit-image disponibles solo durante la
preparación de arte). Ejemplo para LGT_02:

```powershell
python scripts/build-storm-lightning-assets.py --source "C:\Arte\forked_crown.png" --slug lgt_02_forked_crown --output public/assets/fx/storm/lightning/lgt_02_forked_crown --root-x 410 --root-y 35 --tip-x 370 --tip-y 850
```

Los puntos de origen y punta se miden en píxeles del PNG original. El generador
valida alpha, tamaño, conectividad, alcance de la ruta y UV. Luego cambiar el
`status` de la variante a `ready` en `LightningVariantLibrary.ts`, revisar su
evento compatible y comprobarla en el laboratorio. No regenerar `LGT_01`.

Verificación: `npm run build` y `node scripts/verify-storm-lab-browser.mjs` con
el servidor Vite activo. La segunda prueba dispara 20 veces y comprueba que no
crezcan los conteos de mallas y luces ni aparezcan errores de consola.
