# Público de las plateas de Rina

`RinaCrowdAssetManifest.ts` registra las variantes de cada fan. El modelo
rigged conserva pesos y huesos para futuras animaciones; la variante `posed`
es una malla estática con una pose de concierto ya horneada. Solo se descarga
la variante `posed` que necesita cada nivel de calidad. Una malla compartida
usa thin instances, por lo que no hay un esqueleto por espectador.

Para agregar `fan_02`:

1. Generar variantes 2K y 1K del GLB de origen con
   `node scripts/optimize-rina-crowd.mjs --input <origen.glb> --id fan_02`.
   El script conserva la skin, comprueba geometría y rig, y no sobrescribe
   archivos existentes sin `--force`.
2. Preparar una pose natural en la herramienta 3D y exportar una malla
   estática por calidad con la textura correspondiente. Revisar que los pies
   queden en Y=0 y que no haya esqueleto en esos GLB.
3. Añadir ambas rutas rigged y posed, la altura medida y el peso de archivo
   a `RINA_CROWD_FANS`. La distribución y los pasillos no cambian.

Las dos variantes rigged de `fan_01` llegaron optimizadas y no se
recomprimieron. Las variantes `posed` derivan de ellas y tienen el brazo
izquierdo alzado y el derecho bajo. Hasta incorporar clips Mixamo o VAT,
el fan mantiene esa pose y solo se balancea como figura completa.
