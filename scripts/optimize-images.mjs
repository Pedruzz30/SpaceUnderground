// Gera os AVIF/WebP de public/ a partir dos PNG originais.
//
// Roda UMA VEZ, a mao, e os arquivos gerados vao versionados junto com os PNG.
// Nao faz parte do `npm run build` de proposito: o CI nao precisa instalar o
// sharp (~50 MB de binario) para publicar um site estatico cujos assets ja
// estao prontos.
//
// Para rodar de novo depois de trocar algum PNG:
//
//   npm install --no-save sharp
//   node scripts/optimize-images.mjs
//
// Se as dimensoes do PNG mudarem, atualize os width/height do <picture>
// correspondente no index.html — eles existem para reservar o espaco e evitar
// layout shift, entao precisam bater com o arquivo servido.

import fs from "node:fs";
import sharp from "sharp";

const TARGETS = ["NoteBookSpaceU.png", "tattoo-preview-poster.png", "LucasNutri.png"];

const kb = (bytes) => (bytes / 1024).toFixed(1) + " KB";

// O canal alpha e mesmo usado? Se for opaco do primeiro ao ultimo pixel,
// descartar economiza bytes sem mudar nada do que aparece na tela.
async function usesAlpha(source) {
  const meta = await sharp(source).metadata();
  if (!meta.hasAlpha) return false;

  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = info.channels - 1; i < data.length; i += info.channels) {
    if (data[i] !== 255) return true;
  }
  return false;
}

const rows = [];

for (const file of TARGETS) {
  const source = `public/${file}`;
  const base = file.replace(/\.png$/, "");
  const { width, height } = await sharp(source).metadata();
  const keepAlpha = await usesAlpha(source);

  // Sem redimensionar: as dimensoes originais ja servem telas retina, e
  // reduzir seria o unico jeito de degradar visivelmente o traco fino da
  // tipografia e das interfaces nos posters.
  const prepared = () => (keepAlpha ? sharp(source) : sharp(source).flatten({ background: "#000000" }));

  await prepared().avif({ quality: 62, effort: 9, chromaSubsampling: "4:4:4" }).toFile(`public/${base}.avif`);
  await prepared().webp({ quality: 86, effort: 6, alphaQuality: 100, smartSubsample: true }).toFile(`public/${base}.webp`);

  const png = fs.statSync(source).size;
  const avif = fs.statSync(`public/${base}.avif`).size;
  const webp = fs.statSync(`public/${base}.webp`).size;
  const drop = (size) => `-${(100 - (size / png) * 100).toFixed(1)}%`;

  rows.push({
    file,
    size: `${width}x${height}`,
    alpha: keepAlpha ? "kept" : "dropped (opaque)",
    png: kb(png),
    avif: `${kb(avif)} (${drop(avif)})`,
    webp: `${kb(webp)} (${drop(webp)})`,
  });
}

console.table(rows);
