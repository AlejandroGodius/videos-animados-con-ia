# Cortos animados con IA: instrucciones para Claude

Este proyecto hace cortos animados verticales (1080x1920, para YouTube Shorts, TikTok e Instagram) con personajes 2D
dibujados en un mundo 3D con líneas de tinta. Todo es código: three.js dentro de Remotion, voz del usuario, música y
efectos sintetizados aquí mismo. Basado en la skill «cartoon-3d-short» de Mr omi (MIT), adaptada al español y a Windows.

## Con quién hablas

- La persona que te escribe **no sabe programar**. Háblale en español llano, frases cortas, sin jerga. Nunca le pidas
  que abra o edite código. Si tienes que nombrar algo técnico, explica para qué sirve en media frase.
- Antes de cada paso largo, dile en una línea qué vas a hacer y cuánto puede tardar. Al acabar, dile qué ha salido y
  dónde está.
- Enséñale los resultados de verdad: los scripts abren las imágenes y los vídeos con el programa normal del ordenador.
  Si no se abren, dile la ruta exacta.
- Pide permiso antes de: gastar dinero, usar servicios de pago, instalar algo que no esté en este archivo o en el
  README, o borrar cosas fuera de la carpeta del proyecto. No publiques nada en internet.
- Cuando algo falle, no le cuentes el error en crudo: dile qué pasa en una frase y arréglalo (sección «No me sale»).

## Mapa del proyecto

| Carpeta o archivo | Qué es |
|---|---|
| `src/videos/galeon/` | El corto de ejemplo (plantilla de todos los demás). No lo modifiques: copia la carpeta para cada corto nuevo |
| `src/Root.tsx` | Lista de cortos (composiciones). Id = nombre de la carpeta en PascalCase + `Short` (`mi-pueblo` -> `MiPuebloShort`) |
| `public/<corto>/voice.wav` | Voz limpia de cada corto |
| `public/galeon/kenney/` | Modelos 3D del Pirate Kit de Kenney (CC0): barcos, cofres, palmeras, torres, rocas... |
| `public/kenney-naturaleza/` | Modelos 3D del Nature Kit y parte del Fantasy Town Kit de Kenney (CC0): árboles, rocas, vallas, puestos, molino... |
| `cortos/<corto>/` | Guion con fuentes (`GUION.md`), tiempos de la voz (`words.json`), subtítulos (`subtitulos.ass`) |
| `audio/<corto>/` | Música y efectos sintetizados en Python (numpy/scipy). `mix.py` hace la mezcla final a -14 LUFS |
| `herramientas/` | Scripts: fotogramas, vídeo, voz, subtítulos, comparación con los virales, diagnóstico, limpieza |
| `referencias/` | `medidas-cortos-virales.json` (solo números de 20 cortos virales) y `galeon/` (nuestros fotogramas, referencia visual) |
| `salida/` | Todo lo que se genera (imágenes, pruebas, vídeos). No va a git. Se limpia con «limpia lo que sobra» |
| `.temporales/` | Carpeta temporal de Remotion. Se limpia con «limpia lo que sobra» |
| `.venv/` | El Python del proyecto. En los comandos de abajo, `PY` es `.venv/Scripts/python.exe` en Windows y `.venv/bin/python` en Mac |

Todos los comandos se ejecutan desde la carpeta del proyecto.

## Reglas que no se tocan

1. **Versiones fijadas.** Nunca `npm install <algo>`, `npm update` ni subir versiones. Para reinstalar: `npm ci`. Con
   versiones nuevas de react, three, @react-three/fiber o postprocessing el 3D sale **en blanco sin ningún error**.
2. **Renderiza siempre con los scripts** (`npm run fotogramas`, `npm run video`, `npm run diagnostico`): ponen la
   carpeta temporal del proyecto, el navegador correcto (Windows: Chrome instalado; Mac: el de Remotion) y el modo
   gráfico `angle`. `npm run estudio` (Remotion Studio) usa `remotion.config.ts`, que hace lo mismo.
3. **Cada reacción visual cae 0-3 fotogramas antes de su palabra.** Todo se sincroniza con `cortos/<corto>/words.json`.
4. **Historias reales.** Cada dato del guion lleva su fuente. Si algo no se puede comprobar, se dice o se quita.
5. **Nada de terceros sin permiso:** ni música ni efectos descargados, ni personajes, marcas o logos de nadie. Todo el
   sonido se sintetiza en `audio/<corto>/`. Los personajes se dibujan en `toon.ts`.
6. En rutas dentro de código JS/TS usa siempre `/` (en una cadena, `\r` se convierte en un salto de línea).

## «Enséñame el ejemplo del galeón.»

1. Dile: «Voy a dibujar las 11 escenas del corto de ejemplo para comprobar que todo funciona. Tarda 1-3 minutos.»
2. Ejecuta `npm run fotogramas -- galeon`. Hace una imagen por escena en `salida/galeon/escenas/` y abre `hoja.jpg`
   con todas.
3. Mira tú la hoja (léela como imagen) y compárala con `referencias/galeon/escena-01.jpg` y alguna más. Si alguna
   escena sale lisa, en blanco o sin el 3D, ve a «No me sale».
4. Si está bien, dile qué está viendo (el cofre del tesoro en el fondo del mar, el capitán, la batalla, el muelle...)
   y que ya lo tiene funcionando.
5. Ofrécele verlo en movimiento y con la voz: ejecuta `npm run estudio` en segundo plano. Se abre una pestaña del
   navegador (Remotion Studio). Dile: «A la izquierda elige GaleonShort y dale al play con la barra espaciadora. En
   esta vista previa puede ir a tirones; el vídeo final sale fluido.» Si prefiere un vídeo: `npm run video -- galeon
   --prueba` (a media resolución, tarda varios minutos).
6. Termina sugiriendo el siguiente paso: «Cuando quieras, pídeme: Hazme un corto de 45 segundos sobre [tu historia].
   Que todo sea verdad y escríbeme el guion.»

## «Hazme un corto de 45 segundos sobre [historia]. Que todo sea verdad y escríbeme el guion.»

1. **Investiga** con búsquedas web. Cada dato que vaya al guion (fechas, cifras, nombres, lugares) tiene que estar en
   al menos una fuente fiable (enciclopedia, museo, archivo, universidad, prensa seria) y, si es el dato del gancho,
   en dos. Si las fuentes no coinciden, dilo y elige la versión prudente. No inventes nada para que quede mejor.
2. **Elige el ángulo:** el dato más increíble de la historia, que se pueda dibujar (causa y efecto visibles).
3. **Escribe el guion con las 3 reglas** (son las que cumplen los cortos virales de este estilo):
   - **La primera frase es lo más increíble de toda la historia.** Sin saludar, sin presentar. Una paradoja o un dato
     que parece imposible, contado como un hecho, de 10-16 palabras. Mal: «En 1708, un galeón español salió de
     Portobelo rumbo a Cartagena de Indias.» Bien: «En 1708 se hundió un barco cargado de oro, plata y esmeraldas.»
   - **La historia es real.** Situación en 1-2 frases con detalles concretos (año, lugar, cifras), luego 3-6 pasos
     que van a más, un momento de misterio o pregunta y el giro con la explicación real (si ayuda, una comparación
     cotidiana).
   - **El final es seco, con retranca.** Una frase corta e irónica que remata la historia. El vídeo acaba en la última
     palabra: nada de «suscríbete» ni despedidas.
   - Ritmo: en los 20 cortos virales medidos, 3,5-4,1 palabras por segundo (en inglés) y casi sin pausas. Leyendo en
     español una persona va más despacio: la voz del galeón son 124 palabras en 39,8 s (3,1 por segundo). **Para 45 s
     escribe 135-150 palabras.** Frases cortas, de las que se dicen en voz alta. Números en cifra (1708, 600, 11).
   - No describas lo que ya se ve en pantalla. Cada frase tiene que poder dibujarse.
4. **Guárdalo** en `cortos/<corto>/GUION.md` (nombre de carpeta corto, en minúsculas, sin tildes ni espacios, con
   guiones: `faro-de-alejandria`) con el mismo formato que `cortos/galeon/GUION.md`: secciones `## Guion` (solo el
   texto que se lee en voz alta, sin acotaciones), `## Escenas` (tabla: escena, frase, qué se ve), `## Las 3 reglas,
   aplicadas` y `## Fuentes` (tabla: dato, fuente con enlace, nota).
5. **Devuélvele en el chat** el guion completo para leer, cuántas palabras tiene y cuánto durará aproximadamente, las
   escenas en una lista corta y de dónde sale cada dato (con enlaces). Avisa de cualquier dato discutible.
6. Dile que puede pedir cambios como a una persona («más gracioso», «quita eso», «el final más corto») y, cuando le
   guste, que lo grabe: «Abre la Grabadora de sonido (en Mac, Notas de voz), dale al botón rojo y lee el guion rápido
   y sin pausas, como si se lo contaras a un amigo con prisa. Si te trabas, repite la frase y sigue. Luego dime: Ya he
   grabado mi voz. Ponla en el corto.»

Cambios en el guion: aplícalos en `GUION.md`, vuelve a enseñar el guion entero y comprueba que siguen las 3 reglas y
las fuentes.

## «Ya he grabado mi voz. Ponla en el corto.»

1. **Busca la grabación:** `PY herramientas/voz.py buscar`. Mira en la Grabadora de sonido de Windows
   (`Documentos\Grabaciones de sonido` o `Documents\Sound recordings`, también si Documentos está dentro de OneDrive),
   en Notas de voz del Mac, en el Escritorio y en Descargas.
   - Si la más nueva es de las últimas horas y dura lo que el guion, úsala y díselo («Uso la grabación de hoy a las
     17:42, de 46 segundos»). Si hay dudas, pregúntale cuál es.
   - **Mac:** Notas de voz guarda en una carpeta protegida. Si no hay permiso, pídele: «En Notas de voz, arrastra la
     grabación a esta ventana (o al Escritorio) y dime ya está.» Arrastrar un archivo a la terminal pega su ruta.
2. **Prepárala:** `PY herramientas/voz.py preparar "<ruta de la grabación>" <corto>`. Limpia la voz (filtro de graves
   y picos saturados), recorta el silencio de los extremos, la guarda en `public/<corto>/voice.wav`, la transcribe
   palabra a palabra (faster-whisper, modelo large-v3-turbo; la primera vez descarga unos 1,6 GB: avísale) y saca un
   informe: duración, palabras por segundo, pausas largas, frases repetidas y frases del guion que no se oyen.
3. **Arregla lo que diga el informe**, revisando tú la transcripción en `cortos/<corto>/words.json`:
   - Frase repetida porque se trabó: quita el primer intento con `PY herramientas/voz.py cortar <corto> INI-FIN`
     (segundos). Vuelve a transcribir sola.
   - Pausas largas: `PY herramientas/voz.py apretar <corto>` (las deja en 0,30 s dentro de la frase y 0,50 s al acabar
     una frase).
   - Si falta una frase entera o hay un error de contenido, díselo y pídele que grabe solo esa frase; luego únela con
     ffmpeg y vuelve a preparar.
   - Si whisper escribe mal una palabra (nombres, cifras), corrige el texto en `words.json` sin tocar los tiempos.
4. **Sincroniza las escenas con la voz** (si el corto aún no tiene código, primero crea su carpeta como se explica en
   «Anímalo»). En `src/videos/<corto>/story.ts`:
   - `SHOTS`: cada escena empieza (`a`) 2 fotogramas antes de la primera palabra de su frase (`round(start * 30) - 2`)
     y acaba (`b`) donde empieza la siguiente. Sin huecos ni solapes.
   - `TOTAL` = fotograma de la última palabra + 1,5-2 s de cola.
   - Cada acción importante cae en su palabra: «se hundió» -> el barco se hunde en ese fotograma (0-3 antes).
   - Copia los tiempos de las escenas a `cortos/<corto>/marcas.json` (`{"s01": 0.0, "s02": 4.18, ...}` en segundos).
   - Cambia la voz del componente principal a `staticFile("<corto>/voice.wav")`.
5. Dile en llano qué has hecho: «Tu voz dura 46 segundos, vas a 3,2 palabras por segundo, he quitado una frase que
   repetiste y cada escena empieza justo con su frase.»

## «Anímalo y enséñame cómo queda cada escena antes de hacer el vídeo.»

Avísale de que la primera versión tarda: el galeón de ejemplo necesitó unos 40 minutos de trabajo para su primera
versión y varias rondas de ajustes después. Mientras, ve contándole en una línea en qué escena estás.

1. **Crea el corto a partir del galeón:**
   - Copia `src/videos/galeon/` a `src/videos/<corto>/`. Renombra `Galeon.tsx` y sus exportaciones (`GaleonShort`,
     `GALEON_FRAMES`) al nombre nuevo y regístralo en `src/Root.tsx` con id `<Corto>Short`.
   - La voz: `staticFile("<corto>/voice.wav")`. Los modelos de Kenney pueden seguir cargándose de `galeon/kenney/`
     (y de `kenney-naturaleza/` para cortos en tierra).
2. **Qué hay en cada archivo** (y qué tienes que reescribir para la historia nueva):
   - `story.ts`: escenas (`SHOTS`), lugares (coordenadas en metros), luz de cada escena (`lightOf`: day, golden,
     dusk, under, deep), cámaras (`CAMS`: claves con `cut` o deslizamientos suaves de 18-40 fotogramas), sacudidas en
     los impactos (`KICKS`), desenfoque de fondo (`DOF`, `cInf` 0 en planos generales y 8-15 en primeros planos),
     destello blanco tras el gancho (`FLASH_AT`).
   - `world.ts`: el mundo (cielo, mar o suelo, niebla, islas, edificios, colocación de todo por fotograma). Carga los
     modelos de Kenney en `loadKit`.
   - `hero.ts`: los objetos protagonistas construidos y pintados en código (barcos, cofre, bote, robot submarino).
     Para que no parezca genérico, los objetos importantes de la historia se hacen aquí, no con modelos de Kenney tal cual.
   - `toon.ts`: dibujo de personajes (API `Pen`), trajes (`Outfit`: jacket, pants, boots, hat = tricorn, pith (casco de
     explorador), tophat, cap, bonnet, bandana, diver, shako, hair...), 20 expresiones (`Expr`), efectos 2D (humo,
     estrellas, salpicaduras, notas...).
   - `cast.ts`: quién sale en cada escena, dónde, con qué pose y expresión (`stage`), parpadeos y caminar.
   - `lights.ts`: presets de luz (`LIGHTS`), cielo y agua (`LOOK`), color de la tinta (`INK`).
   - `paint.ts`, `build.ts`, `shade.ts`: texturas pintadas, casas y materiales. `ink.ts`, `lensblur.ts`, `grade.ts`:
     líneas de tinta, desenfoque y color final. El componente principal (`Galeon.tsx` copiado) une todo.
3. **Valores del estilo que funcionan** (de la skill original, probados): personajes de unas 3,5 cabezas de alto, cabeza
   en forma de judía, tinta de personajes ciruela oscuro, sin coloretes ni brillos en los ojos; cámara que nunca está
   quieta (en los planos quietos, acercamiento lento de 0,15-0,35 % por fotograma); cortes secos solo en saltos
   grandes; desenfoque de fondo en 1/3 del tiempo; sombras azul-violeta, nunca marrones. En los virales, la cabeza del
   personaje principal ocupa de mediana el 15 % del alto de la pantalla.
4. **Trampas conocidas** (compruébalas en cada escena nueva):
   - Los materiales del Nature Kit de Kenney vienen verdeazulados: recoloréalos por nombre de material al cargarlos.
   - La cámara puede quedar dentro de una casa o un objeto: aparta lo que tape la vista.
   - Un objeto a menos de 2 m del objetivo sale como una mancha gigante cortada en el borde: quítalo o aléjalo.
   - Un arbusto cortado por el borde parece una «bola verde»: lo que esté en primer plano tiene que reconocerse.
   - Banderas, uniformes y escudos de la época correcta (el galeón lleva la cruz de Borgoña, no la bandera actual).
   - Carteles iluminados de lado se vuelven grises e ilegibles: material sin iluminación para la cara del cartel.
   - Barandillas a la altura del pecho cruzan a los personajes: sube la cámara para que crucen las piernas.
   - Un plano totalmente quieto parece congelado: siempre un acercamiento lento.
   - Un columpio con una sola cuerda que desaparece detrás del niño parece un ahorcado: dos cuerdas y tabla ancha.
5. **Fotogramas:** `npm run fotogramas -- <corto>`. Antes de enseñárselos, **míralos tú** (lee `hoja.jpg` y las
   escenas que dudes): ¿sale el 3D?, ¿se entiende la frase de esa escena?, ¿se ve al personaje?, ¿hay algo tapando la
   cámara?, ¿fechas, banderas y lugares correctos? Arregla lo evidente y repite solo esas escenas
   (`npm run fotogramas -- <corto> 3,5`).
6. **Enséñaselos:** la hoja se abre sola. Dile en una línea qué pasa en cada escena y pregúntale qué quiere cambiar.
   Recuérdale que manda él: «Háblame como a un dibujante: en la escena 3, el barco más grande y al atardecer.»

## Órdenes sobre las escenas («en la escena 3, el barco más grande y al atardecer»)

- «Escena N» es el `id` N de `SHOTS` en `story.ts` (y la imagen `escena-0N.jpg`).
- Traduce cada orden al cambio concreto y haz solo ese cambio:
  - Tamaño de un objeto o personaje: su escala en `world.ts`/`hero.ts`/`cast.ts`, o la cámara más cerca (`CAMS`).
  - Hora del día: `lightOf` en `story.ts` (day, golden = atardecer dorado, dusk = anochecer, under/deep = bajo el agua).
  - Más humo, fuego, polvo, chispas: efectos 2D de `toon.ts` colocados en `cast.ts` para esa escena.
  - Más movimiento: claves de cámara en `CAMS`, sacudidas en `KICKS`, poses y efectos en `cast.ts`.
  - Ropa, sombrero, cara de un personaje: su `Outfit` y su expresión en `toon.ts`/`cast.ts` (el sombrero de explorador
    es `hat: "pith"`).
- Después, rehaz **solo esa escena**: `npm run fotogramas -- <corto> 3`. Se abre la imagen. Dile qué has cambiado.
- Si la orden no está clara («ponlo más bonito»), propón 2 opciones concretas o sugiere: «Compáralo con los cortos
  virales y arréglalo».

## «Compáralo con los cortos virales y arréglalo.»

Aquí no se adivina: se mide. `referencias/medidas-cortos-virales.json` tiene los números de 20 cortos virales del
mismo estilo (brillo, contraste, oscuros, claros, saturación, colorido, cantidad y grosor de las líneas de tinta, cielo
sobre suelo, color de luces y sombras, tamaño del personaje). Los fotogramas originales no están en el proyecto: son de
un canal de terceros. Nunca nombres ese canal.

1. Si las imágenes de las escenas no están al día, rehazlas: `npm run fotogramas -- <corto> --sin-abrir`.
2. Mide: `PY herramientas/comparar-con-virales.py salida/<corto>/escenas --regla salida/<corto>/comparacion --json salida/<corto>/comparacion/antes.json`.
   Dice qué medidas se salen del rango de los virales en el corto entero y escena por escena, y qué tocar primero.
3. Mira tú las imágenes con regla (`salida/<corto>/comparacion/regla-*.jpg`) para el tamaño del personaje, y nuestras
   escenas de `referencias/galeon/` como referencia visual del estilo.
4. Arregla las 3 prioridades que salgan (el comparador dice el archivo y el parámetro). Cambios pequeños y medibles.
5. Rehaz las escenas, vuelve a medir (`--json salida/<corto>/comparacion/despues.json`) y repite si hace falta (como
   mucho 3 rondas).
6. Enséñale el antes y el después juntos, por ejemplo con
   `ffmpeg -y -i antes.jpg -i despues.jpg -filter_complex hstack=inputs=2 antes-despues.jpg`, y dile en llano qué
   estaba mal y cómo ha quedado, con los números: «La saturación estaba en 0,31 y los virales van de 0,38 a 0,55; ahora
   está en 0,42.»
7. Sé honesto: los números dicen si el color, el contraste o las líneas están en rango, no si la escena cuenta bien la
   historia. Eso míralo en la imagen. Ojo: el propio galeón sale más saturado y colorido que la media de los virales
   (es un corto de mar caribeño); fuera de rango no siempre es malo si es una decisión.

## «Haz el vídeo final, con música y subtítulos.»

1. Comprueba que la voz y los tiempos están cerrados. Cualquier cambio de tiempos después obliga a rehacer el sonido.
2. **Música y efectos** (todo sintetizado aquí, sin derechos de terceros):
   - Copia `audio/galeon/` a `audio/<corto>/` (el nombre de la carpeta decide qué voz y qué tiempos usa).
   - `timeline.py`: copia los tiempos de `story.ts` (`SHOTS`, `TOTAL`) y los momentos con sonido (impactos, golpes,
     salpicaduras, cambios de escena).
   - `music.py`: `SECTIONS` (una sección por parte de la historia) y `build()`: el carácter de cada sección (misterio,
     épica, tensión, comedia, final). Melodías nuevas; solo recursos generales.
   - `sfx.py`: los efectos de cada momento de `timeline.py`.
   - Ejecuta `PY audio/<corto>/mix.py`. Deja `salida/<corto>/audio/mix.wav` (voz por encima, música 5-10 dB por debajo
     de la voz, -14 LUFS, pico máximo -1 dBTP, misma duración que el vídeo) y `cues.md` con todos los efectos.
3. **Subtítulos:** `PY herramientas/subtitulos.py <corto>`. Una palabra cada vez, Arial Black blanca con borde negro y
   efecto de entrada, escritas como en el guion (tildes, mayúsculas, números).
4. **Vídeo:** avísale de que tarda (en el portátil donde se probó, la versión de prueba a media resolución de 42 s
   tardó unos 9 minutos; la final, más) y de que el ordenador irá a tope. Ejecuta `npm run video -- <corto>`.
   Renderiza la imagen, la junta con la mezcla, quema los subtítulos y comprueba el volumen.
5. **Comprueba** antes de dárselo: 1080x1920, dura `TOTAL / 30` segundos, suena (volumen cerca de -14 LUFS), los
   subtítulos se ven. Saca 3 fotogramas con ffmpeg y míralos.
6. El vídeo se abre solo. Dile dónde está (`salida/<corto>/<corto> - final.mp4`) y que ya puede subirlo como Short a
   YouTube, TikTok o Instagram. Recuérdale: «Cuando acabes, dime limpia lo que sobra, que estos vídeos ocupan bastante.»

Si pide ayuda para subirlo: la primera imagen tiene que ser lo más llamativo de la historia; el título, corto y sin
contar el final. Propón 3 títulos.

## «Limpia lo que sobra.»

1. `npm run limpiar -- --simular` y dile en una frase qué se va a borrar y cuánto ocupa.
2. `npm run limpiar`. Borra la carpeta temporal de Remotion, imágenes de prueba, vídeos intermedios y mezclas de
   audio. **Conserva los vídeos finales**, las voces, los guiones y el código.
3. Dile cuánto espacio ha liberado. Si el script avisa de restos de Remotion en la carpeta temporal del sistema,
   pregúntale antes de borrarlos (`npm run limpiar -- --tambien-sistema`).

## «No me sale» / «Me sale en blanco»

1. Ejecuta `npm run diagnostico` y, si las comprobaciones salen bien pero el problema es de imagen,
   `npm run diagnostico -- --render` (hace un cubo de prueba sin efectos, con efectos y una escena del galeón, y si el
   cubo no se ve prueba otros modos gráficos).
2. Arreglos conocidos:

| Síntoma | Causa | Arreglo |
|---|---|---|
| Las imágenes salen en blanco sin ningún error | Versiones distintas de las fijadas (pasó al instalar las últimas) | `npm ci`. Nunca `npm install <algo>` ni `npm update` |
| El cubo con efectos sale en blanco y sin efectos no | Versiones de `@react-three/postprocessing` / `postprocessing` | `npm ci` |
| Ni el cubo sale | La tarjeta gráfica o el modo `angle` | Prueba `GL=swangle npm run fotogramas -- <corto>` (más lento). Actualiza el controlador gráfico. En Windows, instala Chrome (`winget install -e --id Google.Chrome`) |
| «ENOSPC», disco lleno | Remotion copia el proyecto en cada render | `npm run limpiar`. Si hace falta, otra carpeta temporal con la variable `REMOTION_TMP` |
| «No encuentro node / ffmpeg / python» justo después de instalarlos | La ventana de Claude Code se abrió antes de instalarlos | Usa la ruta completa (Windows: `C:\Program Files\nodejs\`, `%LOCALAPPDATA%\Microsoft\WinGet\Links\`, `%LOCALAPPDATA%\Programs\Python\Python312\`) o pide cerrar y volver a abrir Claude Code |
| Escribir `python` abre la Microsoft Store | Alias de Windows | Usa `py -3.12` o la ruta completa; el proyecto usa siempre `.venv` |
| El render se corta por memoria o tiempo de espera | El modo `angle` gasta memoria en renders largos | `CONCURRENCIA=1 npm run video -- <corto>` |
| Tarda mucho en «delayRender» / no carga modelos | Faltan modelos en `public/` o el disco va lento | Comprueba `public/galeon/kenney/` y la ruta en `loadKit` |
| Va lento o da errores de archivos bloqueados | El proyecto está dentro de OneDrive | Mueve la carpeta fuera de OneDrive |
| Mac: no encuentra las Notas de voz | Carpeta protegida del sistema | Pídele que arrastre la grabación a la ventana |
| Los subtítulos no salen | ffmpeg sin libass | Mac: `brew install ffmpeg-full`. Windows: `winget install -e --id Gyan.FFmpeg` |

3. Cuéntale qué pasaba en una frase y comprueba que ya funciona repitiendo lo que fallaba.

## Instalación (por si se cortó a medias)

Los pasos completos están en el `README.md`, sección «Instrucciones para Claude Code». Resumen: Node LTS, ffmpeg y
Python 3.10 o más; `npm ci`; en Mac (o en Windows sin Chrome) `npx remotion browser ensure`; `.venv` con
`requirements.txt`; `npm run diagnostico`.
