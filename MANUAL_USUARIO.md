# Manual de usuario de Bosque Babylon

Este manual describe las mecánicas disponibles en la versión actual del juego. La sección de progresión y enemigos avanzados contiene spoilers leves.

## 1. Objetivo y comienzo de la partida

Bosque Babylon es un juego de exploración y supervivencia en tercera y primera persona. El objetivo general es avanzar por el bosque, administrar la Vida, la Cordura y las Esferas de Luz, encontrar la forma de entrar a la casa y sobrevivir a los encuentros del tramo final.

Antes de comenzar se puede elegir entre **Lautaro** y **Sofía**. La elección se guarda en el navegador y cambia el personaje visible, pero ambos comparten las mismas capacidades y estadísticas.

La partida comienza con:

- 100 puntos de Vida.
- 100 puntos de Cordura.
- 3 Esferas de Luz, con una capacidad máxima de 6.
- La linterna encendida.

## 2. Controles

### Teclado y ratón

| Acción | Control |
| --- | --- |
| Moverse | `WASD` o flechas |
| Mirar y apuntar | Movimiento del ratón |
| Correr | `Shift` izquierdo o derecho |
| Saltar | `Espacio` |
| Bucear o volver a flotar | `Espacio`, cuando corresponde |
| Interactuar | `E` |
| Encender o apagar la linterna | `F` |
| Cambiar cámara principal | `V` |
| Entrar en modo de Esfera de Luz | Mantener botón derecho del ratón |
| Cargar y lanzar una Esfera de Luz | Mantener botón izquierdo mientras se mantiene el derecho; soltar el izquierdo para lanzar |
| Absorber una Esfera de Luz para recuperar Cordura | Mantener `Q` |
| Abrir o cerrar el inventario | `I` |
| Pausar, cancelar o volver | `Esc` |

Al hacer clic sobre el juego, el ratón queda capturado para controlar la cámara. `Esc` libera el puntero y abre la pausa cuando no hay otro panel abierto.

Los botones del HUD permiten acceder directamente a las cámaras frontal e isométrica, a la linterna y a la pausa.

### Gamepad estándar

| Acción | Xbox | PlayStation |
| --- | --- | --- |
| Moverse | Stick izquierdo | Stick izquierdo |
| Mirar | Stick derecho | Stick derecho |
| Saltar / acción de agua | `A` | `✕` |
| Cancelar / volver | `B` | `○` |
| Interactuar | `X` | `□` |
| Cambiar cámara | `Y` | `△` |
| Absorber luz | `LT` | `L2` |
| Cargar y lanzar una esfera | `RT` | `R2` |
| Inventario | `View` | `Crear/Share` |
| Pausa | `Menu` | `Options` |
| Correr | `L3` | `L3` |

La distribución sigue el estándar web para gamepads. En mandos sin mapeo estándar pueden aparecer números de botón. La linterna no tiene un botón de gamepad asignado en la configuración predeterminada, pero puede manejarse desde el botón del HUD.

### Pantalla táctil

- Joystick izquierdo: movimiento.
- Zona derecha: cámara y apuntado.
- Botón de luz: mantener para cargar y soltar para lanzar una esfera.
- Botón de salto: saltar o realizar la acción de agua.
- Botón de carrera: correr; en el agua también funciona como acción de buceo.
- Botón de interacción: recoger, inspeccionar o usar objetos.
- Botón de absorción: mantener para consumir esferas y recuperar Cordura.
- Botón de cámara: recorrer las cámaras disponibles.

## 3. Cámaras

La vista inicial es en tercera persona. `V`, el botón de cámara móvil o el botón principal del HUD recorren las vistas de **tercera persona**, **primera persona** e **isométrica**.

- En primera persona el personaje no tapa el centro de la pantalla.
- En tercera persona la cámara ajusta su distancia para evitar atravesar el terreno y los objetos.
- En vista isométrica el movimiento se adapta a la pantalla y el ratón o stick derecho orienta el apuntado.
- La vista frontal se activa por separado con el botón `FR` del HUD y vuelve a tercera persona al desactivarla.
- La mira central se oculta en las vistas frontal e isométrica.
- Desde la zona de la casa en adelante, la vista isométrica queda deshabilitada por diseño.

## 4. Movimiento, colisiones y agua

El personaje puede caminar, correr y saltar. Correr es más rápido, pero también permite que los Atrapasombras detecten al jugador desde más lejos y aumenta la pérdida de Cordura en oscuridad total.

El terreno, los árboles, las rocas, la casa y los objetos grandes bloquean el movimiento. La cámara de tercera persona también se acerca automáticamente cuando no tiene espacio detrás del personaje.

En agua suficientemente profunda se activan dos estados:

1. **Flotación:** el personaje se mantiene en la superficie y se mueve lentamente.
2. **Natación:** `Espacio` o el botón de acción de agua inicia el buceo. El movimiento hacia delante y atrás sigue la inclinación de la cámara, lo que permite descender y ascender.

Al acercarse otra vez a la superficie, la misma acción permite volver al estado de flotación. En agua poco profunda el personaje regresa automáticamente al movimiento terrestre. Mientras se bucea no se puede absorber luz ni regenerar Vida.

## 5. HUD y recursos

El HUD muestra:

- Vida y Cordura actuales.
- Esferas de Luz disponibles y capacidad máxima.
- Progreso de carga del lanzamiento o de recarga junto a una llama.
- Mensajes de interacción y estado.
- Barra de Vida del Atrapasombras alcanzado.
- Barra del Testigo Acusador durante el encuentro final.

### Vida

La Vida representa el daño físico. Los agarres de los Atrapasombras reducen Vida y también provocan pérdida de Cordura.

La Vida comienza a regenerarse si se cumplen todas estas condiciones:

- Han pasado al menos 5 segundos desde el último daño.
- La Cordura está por encima de 55.
- El personaje no está buceando ni atrapado.

Cuanta más Cordura haya, más rápida será la regeneración. Los santuarios de luz también la aceleran.

### Cordura

La Cordura controla la vulnerabilidad y la percepción del personaje. Al caer a 25 o menos aparecen efectos perceptivos más intensos. Con Cordura alta se recibe menos daño; en crisis se recibe más.

La Cordura disminuye por:

- Permanecer fuera del sendero iluminado durante más de unos segundos.
- Estar en oscuridad total; correr en ella acelera la pérdida.
- Recibir daño físico.
- Ser agarrado o retenido por un Atrapasombras.
- Quedar rodeado por varios Atrapasombras que estén atacando desde ángulos distintos.
- Permanecer expuesto a la mirada del Testigo Acusador.

La luz permite una recuperación natural gradual, con diferentes límites:

- La linterna o una luz débil pueden recuperar hasta 60 de Cordura.
- El sendero iluminado puede recuperar hasta 75.
- Un santuario de luz puede recuperar hasta 100.

La recuperación natural se detiene mientras existe una fuente activa de pérdida de Cordura.

### Esferas de Luz

Las Esferas de Luz cumplen tres funciones:

1. Servir de munición contra los enemigos.
2. Recuperar Cordura mediante absorción.
3. Volver a encender velas apagadas.

La capacidad máxima es de 6. Al permanecer muy cerca de una llama activa, las esferas se recargan automáticamente de una en una. La recarga necesita un breve periodo sin disparar y se detiene mientras se carga un lanzamiento o al alejarse de la fuente.

Mantener `Q`, `LT/L2` o el botón táctil de absorción consume una esfera aproximadamente cada 0,8 segundos y restaura 30 puntos de Cordura. En una sola pulsación prolongada se pueden consumir hasta 3 esferas. Correr, atacar, recibir daño, bucear, quedar atrapado, pausar o soltar el control interrumpe la absorción.

## 6. Linterna, velas y zonas seguras

La linterna se enciende y apaga con `F` o con su botón del HUD. Evita la oscuridad total mientras está encendida y, si su haz se mantiene sobre un Atrapasombras, lo ralentiza y finalmente lo repele. Una exposición sostenida también puede romper un agarre.

Las velas y otras llamas fijas tienen varios efectos:

- Los Atrapasombras evitan acercarse demasiado a una luz intensa.
- Las llamas activas permiten recargar Esferas de Luz al permanecer cerca.
- Una vela cercana cuenta como luz débil para la recuperación de Cordura.
- Las antorchas del tramo final y la vela del santuario ofrecen la recuperación más fuerte.

### Velas que apagan los Atrapasombras

Un Atrapasombras alertado puede abandonar temporalmente la persecución para buscar una vela encendida cercana. Al alcanzarla, apaga la llama.

Cuando una vela se apaga:

- Desaparecen su llama, brillo y partículas.
- Deja de actuar como zona segura para los Atrapasombras.
- Ya no permite recargar Esferas de Luz.
- Deja de contribuir como luz ambiental a la recuperación de Cordura.
- Permanece apagada aunque el sector del bosque salga y vuelva a entrar en memoria durante esa partida.

Para volver a encenderla, hay que **lanzar una Esfera de Luz e impactar la vela apagada**. El disparo consume la esfera y reactiva inmediatamente la llama, la protección y la recarga.

No todas las fuentes pueden apagarse. Los braseros y las luces de santuario permanentes siguen activos.

## 7. Combate con Esferas de Luz

En teclado y ratón, hay que mantener el botón derecho para entrar en modo de orbe. Mientras se mantiene, se pulsa y sostiene el botón izquierdo para cargar. Al soltar el izquierdo se lanza la esfera; al soltar el derecho se cancela el modo y una carga pendiente no consume munición.

En gamepad o pantalla táctil basta con mantener el control de ataque y soltarlo para lanzar.

Durante la carga:

- Aparece una trayectoria prevista.
- La potencia de lanzamiento aumenta hasta su máximo en 1,5 segundos.
- Si un enemigo queda dentro del cono de ayuda de apuntado, la trayectoria intenta compensar la caída del proyectil.

La carga aumenta la velocidad y el alcance del lanzamiento, pero cada impacto válido causa una unidad fija de daño. Cada lanzamiento consume una esfera al ser liberado.

## 8. Enemigos y amenazas

### Atrapasombras

Los Atrapasombras detectan, persiguen, rodean y coordinan sus ataques. Solo uno del mismo grupo inicia un ataque a la vez, pero varios pueden colocarse alrededor del jugador y aumentar la presión sobre la Cordura.

Reglas principales:

- Correr aumenta su alcance de detección.
- Las velas y luces fijas condicionan sus rutas y frenan su avance.
- La linterna los ralentiza y puede hacerlos retroceder si se mantiene enfocada.
- Un agarre causa daño inicial, reduce Cordura y dificulta el movimiento mientras dura.
- Alejarse, alcanzar luz intensa o mantener la linterna sobre la criatura ayuda a romper el agarre.
- Dos impactos de Esfera de Luz derrotan a un Atrapasombras con la Vida completa.
- También pueden desviarse para apagar velas comunes y eliminar zonas seguras.

### Hermano Mayor — spoiler leve

Después de entrar en la casa y volver a salir, el Hermano Mayor puede activarse si logra ver al personaje. Sigue al jugador dentro de su zona, busca rutas alrededor de obstáculos y se detiene a corta distancia para observar. Su respiración cambia durante la persecución y también puede oírse cuando está cerca pero fuera de cámara.

En la versión actual su comportamiento es de acecho: todavía no causa daño de combate ni utiliza el sistema de arma reservado para una versión futura.

### Testigo Acusador — spoiler del encuentro final

Entrar en la laguna activa una presentación durante la cual los controles quedan bloqueados. La primera aparición produce una pérdida única de Cordura.

Después de la presentación:

- Su barra de Vida aparece en el HUD.
- Mientras exista línea de visión entre el ojo y el personaje, la Cordura se pierde cada vez más rápido.
- Romper la línea de visión detrás del entorno reduce gradualmente la exposición acumulada.
- Se necesitan 18 impactos de Esfera de Luz para derrotarlo desde su Vida completa.
- Las luces del área permiten recuperar munición y Cordura durante el encuentro.

## 9. Interacción, objetos e inventario

Al mirar un objeto interactivo cercano aparece el mensaje `E: interactuar`. La interacción también puede detectarse por proximidad en las cámaras que no apuntan directamente desde el centro.

Objetos disponibles en la versión actual:

- **Nota:** se añade al inventario y abre su imagen para leerla.
- **Caja de fósforos:** añade 25 fósforos al inventario.
- **Llave del bosque:** permite desbloquear la puerta de la casa.
- **Puerta de la casa:** puede abrirse y cerrarse; la primera apertura exige haber recogido la llave.
- **Foto:** se añade como recuerdo y puede inspeccionarse otra vez desde el inventario.
- **Hacha ensangrentada:** activa una inspección en el mundo, pero no se recoge.

`I` abre el inventario. Allí se puede filtrar por tipo, consultar cantidades y volver a inspeccionar notas, imágenes o modelos compatibles. `Esc` cierra primero el inspector o el inventario antes de abrir la pausa.

Los fósforos están registrados como consumible, pero en esta versión todavía no tienen una acción de uso. Las velas apagadas se encienden con Esferas de Luz.

## 10. Progresión general — spoilers leves

1. Seguir el sendero permite encontrar los primeros recursos y la nota.
2. La Llave del Bosque aparece antes de la casa y es necesaria para abrir su puerta.
3. Dentro y alrededor de la casa hay objetos inspeccionables, una vela y el encuentro con el Hermano Mayor.
4. Al continuar hacia la zona acuática se habilitan la natación y el buceo.
5. Entrar en la laguna inicia el encuentro con el Testigo Acusador.

No existe un marcador de misión tradicional: los destellos de los objetos, los mensajes de interacción, el sendero y las fuentes de luz guían el avance.

## 11. Pausa, opciones y guardado

El menú de pausa incluye:

- Volumen de música, ambiente y efectos.
- Resolución interna automática o escalas de 100 %, 80 %, 67 % y 50 %.
- Pantalla completa.
- Activación del filtro VHS.
- Selección de teclado/ratón o gamepad y consulta de la distribución detectada.

El botón **Guardar** conserva en el almacenamiento local del navegador:

- Vida.
- Cordura.
- Cantidad de Esferas de Luz.
- Eventos narrativos únicos ya aplicados.

El guardado actual **no es un punto de control completo**: no conserva la posición, el resto del inventario, enemigos derrotados, puertas, objetos recogidos ni el estado encendido o apagado de las velas. El botón **Continuar** cierra la pausa y vuelve al juego.

## 12. Consejos rápidos

- No gastes todas las esferas atacando: también son una reserva de Cordura y la única forma actual de reencender velas.
- Si una vela se apaga, elimina primero la amenaza o repélela con la linterna antes de acercarte a recargar.
- Camina cuando puedas. Correr en la oscuridad empeora la pérdida de Cordura y alerta a los enemigos desde más lejos.
- Mantén al menos una llama activa cerca de los combates largos para recuperar munición.
- Contra el Testigo Acusador, alterna entre cobertura, recarga y ataques; quedarse expuesto hace que el drenaje de Cordura aumente.
- La vista isométrica facilita la exploración del bosque, pero conviene acostumbrarse a primera o tercera persona antes de llegar a la casa.
