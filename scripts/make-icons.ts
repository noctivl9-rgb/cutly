// Génère les icônes PNG de la PWA (fond noir, X rouge dans un cadre).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const OUT = join(import.meta.dirname, '..', 'public', 'icons');

function icon(size: number) {
  const png = new PNG({ width: size, height: size });
  const set = (x: number, y: number, [r, g, b]: number[]) => {
    const i = (y * size + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  const bg = [11, 12, 14], red = [168, 43, 53], paper = [240, 236, 228];
  const m = size * 0.22, frame = Math.max(2, size * 0.025), stroke = size * 0.075;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = bg;
      const inFrame = x >= m && x <= size - m && y >= m && y <= size - m;
      const onFrame = inFrame && (x < m + frame || x > size - m - frame || y < m + frame || y > size - m - frame);
      if (onFrame) c = paper;
      const inner = x > m * 1.45 && x < size - m * 1.45 && y > m * 1.45 && y < size - m * 1.45;
      if (inner && (Math.abs(x - y) < stroke || Math.abs(x + y - size) < stroke)) c = red;
      set(x, y, c);
    }
  }
  return PNG.sync.write(png);
}

for (const size of [180, 192, 512]) writeFileSync(join(OUT, `icon-${size}.png`), icon(size));
console.log('Icônes générées dans', OUT);
