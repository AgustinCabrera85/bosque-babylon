# Público de las plateas de Rina

`RinaCrowdAssetManifest.ts` registra las variantes de cada fan. El modelo
rigged conserva pesos y huesos; la variante `posed` es una malla estática con
una pose de concierto ya horneada. Los fans sin clips descargan `posed`; los
fans animados descargan el GLB rigged de la calidad correspondiente. Las
thin instances comparten malla y, en los fans animados, rig por grupo.

Para agregar otro fan:

1. Preparar el GLB 1K con rig y clips NLA, y comprobar sus nombres y el origen
   de los pies. `scripts/optimize-rina-crowd.mjs` sirve para optimizar una
   fuente que todavía no tenga variante 1K.
2. Registrar la ruta, los clips, la altura objetivo y el tamaño del archivo en
   `RINA_CROWD_FANS`. Si solo existe una variante 1K, ambas calidades pueden
   apuntar a ella.
3. Comprobar en el navegador las instancias, la separación entre asientos y
   que cada rig reproduzca solo un clip a la vez.

`fan_01`, `fan_02` y `fan_03` usan sus GLB NLA 1K para las gradas, incluida
una pequeña selección de filas cercanas. `fan_01` animado reemplaza a la
versión estática anterior. Sus alturas objetivo son 2,65 m, 2,55 m y 2,80 m,
respectivamente, alrededor de la altura de Lautaro (2,68 m). Tienen cinco,
cuatro y cuatro clips. Cada tipo comparte un rig entre sus thin instances.

`fan_04` usa directamente sus archivos NLA optimizados: 1K para las plateas
(hasta 68 en escritorio y 16 en móvil, con prioridad para la tribuna trasera,
incluidas sus filas lejanas) y 2K para un ejemplar de
prueba en el pasillo central del campo en escritorio. En móvil solo se carga 1K. Se reserva
espacio alrededor de cada fan animado para sus movimientos. Cada calidad
usa un grupo de thin instances con un rig compartido. Al acabar cada clip,
elige aleatoriamente otro clip registrado. Así los espectadores animados no
necesitan un esqueleto por persona ni reproducen varias poses a la vez.
Los modelos importados usan la respuesta PBR de Lautaro sin autoiluminación.
Dos luces direccionales compartidas iluminan desde el público y el escenario;
su intensidad sigue la música, mientras el lado opuesto conserva sombra.

`fan_05` registra cinco clips NLA y mantiene la altura de `fan_04` (2,50 m).
Sus instancias de las tribunas y la muestra junto a `fan_04` en el campo usan
la variante 1K. La variante 2K queda registrada para una prueba posterior.
Las plazas de todos los fans animados se reservan antes de cargar los GLB para que
no ocupen el mismo lugar.
