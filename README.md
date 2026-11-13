# 🧗‍♀️ Cuaderno de Escalada

App web para registrar entrenamientos de escalada en rocódromo (pensada para **Sharma Climbing Madrid**, pero vale para cualquier sala).
Funciona en el móvil, se puede instalar en la pantalla de inicio y funciona sin conexión.

## Qué hace

- **Sesiones**: fecha, tipo (bloque, vías, mixta, entreno), duración, esfuerzo percibido (RPE), cómo te has sentido y notas.
- **Bloques y vías**: color del circuito o grado francés, resultado (flash, a vista, encadenado, proyecto), intentos, modalidad (primera / polea / autobelay), inclinación, tipo de presas, movimientos, nombre, zona y beta.
- **Registro rápido**: toca un color y queda apuntado, ideal entre pegue y pegue.
- **Fotos** de la sesión o de cada bloque/vía (se comprimen automáticamente).
- **Progreso**: evolución de grado semanal, pirámide de grados, volumen, calendario, estilos fuertes y débiles, proyectos abiertos y encadenados.
- **Tu cuerpo**: mapa corporal con las zonas más trabajadas (dedos, antebrazos, hombros, core…) y consejos de compensación.
- **Consejos automáticos**: racha, cargas altas (riesgo de lesión), estilos olvidados, nuevo máximo, siguiente grado a probar…
- **Logros** desbloqueables y **compartir** el resumen de una sesión.
- **Copia de seguridad** (descargar/restaurar, fotos incluidas) y **datos de ejemplo** para probarla.

## Privacidad

No hay servidor ni cuentas: todo se guarda en el propio navegador del móvil (IndexedDB).
Cada persona que abra el enlace tiene su propio cuaderno, privado. Para cambiar de móvil, usa *Ajustes → Descargar copia* y luego *Restaurar copia*.

## Escala de bloque

Los colores por defecto son orientativos. Los rocódromos cambian los circuitos al reequipar, así que en **Ajustes → Escala de bloque** se pueden editar nombre, color y grado aproximado de cada nivel, o cambiar a grados Font (6A, 6B…).

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
sw.js               uso sin conexión
```

El mapa corporal es una **estimación orientativa** basada en el grado, los intentos y las etiquetas de cada escalada; no es una medida fisiológica. La carga de sesión usa el método sRPE (minutos × RPE).
