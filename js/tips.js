// Consejos de escalada y entrenamiento para quien empieza.
export const TIPS = [
  { cat: 'Técnica', text: 'Mira dónde pones los pies antes de mover las manos. Un pie bien colocado te ahorra muchísima fuerza de brazos.' },
  { cat: 'Técnica', text: 'Escala con los brazos estirados siempre que puedas: cansan mucho menos que con los codos doblados.' },
  { cat: 'Técnica', text: 'Pisa con la punta del gato, no con el centro del pie: así puedes girar y llegar más lejos.' },
  { cat: 'Técnica', text: 'Pega la cadera a la pared en los bloques verticales: tu peso se va a los pies y no a los brazos.' },
  { cat: 'Técnica', text: 'Antes de empezar un bloque, léelo desde el suelo: imagina dónde irán tus manos y tus pies.' },
  { cat: 'Técnica', text: 'Prueba a poner el pie en silencio: si no hace ruido es que lo has colocado con precisión.' },
  { cat: 'Técnica', text: 'En los desplomes, gira la cadera hacia la pared (pie de fuera) para llegar más lejos sin tirar tanto.' },
  { cat: 'Técnica', text: 'Si un paso no sale, cambia algo: el pie, la mano o la cadera. Repetir lo mismo con más fuerza rara vez funciona.' },
  { cat: 'Técnica', text: 'Fíjate en cómo resuelven el bloque otras personas: copiar movimientos es de las mejores formas de aprender.' },
  { cat: 'Calentamiento', text: 'Calienta 10 minutos: mueve hombros y muñecas y haz un par de bloques muy fáciles antes de apretar.' },
  { cat: 'Calentamiento', text: 'Empieza la sesión con colores fáciles y sube poco a poco: tus dedos y tus hombros te lo agradecerán.' },
  { cat: 'Calentamiento', text: 'Los primeros bloques del día, escálalos despacio y con calma: es el mejor momento para practicar técnica.' },
  { cat: 'Descanso', text: 'Descansa 2–3 minutos entre intentos a un bloque difícil. Con prisa casi nunca sale.' },
  { cat: 'Descanso', text: 'Si tienes los antebrazos «cargados», sacude los brazos y respira hondo antes de volver a intentar.' },
  { cat: 'Descanso', text: 'Deja al menos un día de descanso entre sesiones duras: es en el descanso cuando el cuerpo se hace más fuerte.' },
  { cat: 'Descanso', text: 'Dormir bien mejora tu escalada más que cualquier ejercicio. ¡En serio!' },
  { cat: 'Cuidado', text: 'Si notas dolor en un dedo (no cansancio, dolor), para ese día. Las poleas de los dedos tardan en recuperarse.' },
  { cat: 'Cuidado', text: 'Al bajar de un bloque, destrepa o salta con las rodillas flexionadas y cae sobre la colchoneta con los dos pies.' },
  { cat: 'Cuidado', text: 'Cuida la piel de las manos: lávalas después de escalar y usa crema hidratante por la noche.' },
  { cat: 'Cuidado', text: 'Bebe agua durante la sesión: deshidratada te cansas mucho antes.' },
  { cat: 'Cabeza', text: 'Tener miedo a caer es normal. Practica caídas desde poca altura para ganar confianza poco a poco.' },
  { cat: 'Cabeza', text: 'Respira mientras escalas: aguantar la respiración te pone tensa y gastas más energía.' },
  { cat: 'Cabeza', text: 'No te compares con nadie: compárate con la Laura de hace un mes. Para eso está este cuaderno 😉' },
  { cat: 'Cabeza', text: 'Celebra los intentos, no solo los bloques conseguidos: cada intento te enseña algo.' },
  { cat: 'Progreso', text: 'Para subir de color, intenta conseguir varios bloques de tu color actual. Cuando te salgan con soltura, ¡al siguiente!' },
  { cat: 'Progreso', text: 'Elige un bloque «reto» cada sesión: uno que te cueste. Apúntalo como intentado y vuelve a por él.' },
  { cat: 'Progreso', text: 'Repite los bloques que ya te salen intentando hacerlos más suaves y limpios: es entrenamiento de técnica.' },
  { cat: 'Progreso', text: 'Prueba bloques de estilos distintos (placa, desplome, volúmenes): variar te hace mejor escaladora.' },
  { cat: 'Fuerza', text: 'Fuera del rocódromo, unas planchas y sentadillas un par de veces por semana ayudan mucho a escalar.' },
  { cat: 'Fuerza', text: 'Haz flexiones de vez en cuando: compensan los músculos que más usas al escalar y protegen tus hombros.' },
];

export function tipOfDay(offset = 0) {
  const d = new Date();
  const day = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  return TIPS[(day + offset) % TIPS.length];
}
