const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const { cpSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

// Expo copies public/ into web exports. Keep the PDF worker and fonts local and in sync
// with the renderer, including direct `expo export` calls in Docker builds.
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfPublic = join(__dirname, 'public', 'pdfjs', require('pdfjs-dist/package.json').version);
mkdirSync(pdfPublic, { recursive: true });
cpSync(join(pdfRoot, 'build', 'pdf.worker.min.mjs'), join(pdfPublic, 'pdf.worker.min.mjs'));
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(pdfRoot, directory), join(pdfPublic, directory), { recursive: true });
}

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
