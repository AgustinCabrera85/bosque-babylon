# Público de las plateas de Rina

`RinaCrowdAssetManifest.ts` registra las variantes de cada fan. El modelo
rigged conserva pesos y huesos; la variante `posed` es una malla estática con
una pose de concierto ya horneada. Los fans sin clips descargan `posed`; los
fans animados descargan el GLB rigged de la calidad correspondiente. Las
thin instances comparten malla y, en los fans animados, rig por grupo.

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
izquierdo alzado y el derecho bajo. Este fan mantiene esa pose y se balancea
como figura completa.

`fan_04` usa directamente sus archivos NLA optimizados: 1K para las plateas
(hasta 68 en escritorio y 16 en móvil, con prioridad para la tribuna trasera,
incluidas sus filas lejanas) y 2K para un ejemplar de
prueba en el pasillo central del campo en escritorio. En móvil solo se carga 1K. Se reserva
espacio alrededor de cada fan animado para sus movimientos. Cada calidad
usa un grupo de thin instances con un rig compartido. Al acabar cada clip,
elige aleatoriamente uno de los otros dos. Así los espectadores animados no
necesitan un esqueleto por persona ni reproducen varias poses a la vez.
Los modelos importados usan la respuesta PBR de Lautaro sin autoiluminación.
Dos luces direccionales compartidas iluminan desde el público y el escenario;
su intensidad sigue la música, mientras el lado opuesto conserva sombra.
