# 🧗‍♀️ Cuaderno de Escalada

App web para registrar entrenamientos de escalada en rocódromo (pensada para **Sharma Climbing Madrid**, pero vale para cualquier sala).
Funciona en el móvil, se puede instalar en la pantalla de inicio y funciona sin conexión.

## Qué hace

**Registrar una sesión en segundos:** Clase o Libre (con quién fuiste), y contadores por color de *conseguidos* e *intentados* («3 amarillos, 1 morado intentado»). Si te acuerdas de cuál era, puedes elegir el bloque concreto de la sala. Las notas se clasifican solas (técnica, cabeza, molestias…), en Inicio sale tu próximo reto y cada sesión se puede compartir como imagen.

**Navegación:** Inicio · Sala · ＋ · Progreso · Eventos. El perfil (foto, números, sesiones y ajustes) se abre tocando tu foto en Inicio.

**Eventos:** eventos de Madrid publicados en la web del Sharma (se actualizan solos cada día), bloques y vías recién montados por sector, eventos apuntados a mano (p. ej. promociones vistas en Instagram) y enlace a su Instagram.

**Logros sin final:** constancia, conseguidos, a la primera, racha, colores, «Domina tu color», color completo… al completar un nivel se crea el siguiente automáticamente y la app avisa con «¡Nuevo logro!».

**Bloques concretos de la sala:** eliges Bloque o Vías, salen los bloques montados ahora en la sala (por color y sector) y para cada uno marcas *A la primera*, *Lo conseguí* o *Lo intenté*. Si no sabes cuál era, lo apuntas solo con el color. Cada bloque de la sala queda como **Conseguido**, **Intentando** o **Sin probar**, y en Inicio aparecen **Tus retos** (los que intentaste y siguen montados). Objetivo por defecto: 1 sesión a la semana.

**Novedad v2 — Sala en directo (Sharma Climbing Madrid):** la pestaña *Sala* muestra los bloques y vías montados ahora mismo (sector, circuito, color de presa, número, fecha de apertura, novedades), con el plano de sectores y la foto del muro con la zona de cada bloque. Se registran con un toque (Flash / Encadenado / Proyecto) y la app enseña cuánto llevas de cada circuito (p. ej. «Verde 18/24»). Los datos vienen del widget público de Vertical-Life que enlaza la web de la sala; si no hay conexión se usa la última copia guardada.

- **Sesiones**: fecha, tipo (bloque, vías, mixta, entreno), duración, esfuerzo percibido (RPE), cómo te has sentido y notas.
- **Bloques y vías**: color del circuito o grado francés, resultado (flash, a vista, encadenado, proyecto), intentos, modalidad (primera / polea / autobelay), inclinación, tipo de presas, movimientos, nombre, zona y beta.
- **Registro rápido**: toca un color y queda apuntado, ideal entre pegue y pegue.
- **Fotos** de la sesión o de cada bloque/vía (se comprimen automáticamente).
- **Progreso**: evolución de grado semanal, pirámide de grados, volumen, calendario, estilos fuertes y débiles, proyectos abiertos y encadenados.
- **Consejos automáticos**: racha, cargas altas (riesgo de lesión), estilos olvidados, nuevo máximo, siguiente grado a probar…
- **Bienvenida**, objetivo semanal con anillo de progreso y aviso para instalarla.
- **Logros** desbloqueables y **compartir** el resumen de una sesión.
- **Copia de seguridad** (descargar/restaurar, fotos incluidas) y **datos de ejemplo** para probarla.

## Privacidad

No hay servidor ni cuentas: todo se guarda en el propio navegador del móvil (IndexedDB).
Cada persona que abra el enlace tiene su propio cuaderno, privado. Para cambiar de móvil, usa *Ajustes → Descargar copia* y luego *Restaurar copia*.

## Escala de bloque

Por defecto se usan los circuitos de Sharma Climbing Madrid tal y como los publica la sala (Blanco, Azul, Verde, Joker 1, Amarillo, Joker 2, Rojo, Morado, Negro). En **Ajustes → Circuitos de bloque** se pueden editar nombre, color y grado aproximado de cada nivel, o cambiar a grados Font (6A, 6B…).

## Publicarla (GitHub Pages, gratis)

1. Fusiona esta rama en `main`.
2. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. El workflow `.github/workflows/pages.yml` la publica en cada push a `main`. La URL será `https://<usuario>.github.io/<repositorio>/`.
4. En el móvil: abrir la URL → *Compartir → Añadir a pantalla de inicio* (iPhone) o *Instalar app* (Android).

> GitHub Pages en repositorios privados requiere un plan de pago; en repositorios públicos es gratis (el código es público, pero los datos de cada usuaria **no**, se quedan en su móvil).

## Desarrollo

Es HTML + CSS + JavaScript sin dependencias ni compilación:

```bash
python3 -m http.server 8000
# abrir http://localhost:8000
```

```
index.html          estructura y navegación
styles.css          estilos (claro/oscuro)
js/app.js           vistas, formularios y eventos
js/model.js         grados, etiquetas y modelo de carga corporal
js/insights.js      estadísticas, consejos y logros
js/charts.js        gráficos SVG y mapa corporal
js/db.js            almacenamiento local (IndexedDB) y fotos
js/demo.js          datos de ejemplo
js/sharma.js        datos de la sala (Vertical-Life) y plano/topos
scripts/update-sharma.mjs  genera data/sharma.json y data/events.json (GitHub Actions, cada día)
js/icons.js         iconos SVG
data/               copia de la sala para usar sin conexión
sw.js               uso sin conexión
```

El mapa corporal es una **estimación orientativa** basada en el grado, los intentos y las etiquetas de cada escalada; no es una medida fisiológica. La carga de sesión usa el método sRPE (minutos × RPE).

> App no oficial, sin relación con Sharma Climbing ni con Vertical-Life.
