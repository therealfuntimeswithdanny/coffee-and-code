const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// multiformats maps ./hashes/sha2 to ./dist/src/hashes/sha2-browser.js via the
// "browser" export condition (imported by @atproto/lex-data). Metro resolves the
// condition, then warns the mapped file is not itself a listed exports subpath
// and falls back to file-based resolution — landing on the same file. Resolve
// it directly to silence the warning and skip the fallback pass.
const sha2Browser = path.join(__dirname, 'node_modules/multiformats/dist/src/hashes/sha2-browser.js');
// @formatjs/intl-segmenter only lists "./polyfill.js" (with extension) in its
// exports map; Metro strips the extension when matching exports, misses
// "./polyfill", warns, and falls back to file-based resolution — landing on
// the same file. Resolve it directly to silence the warning.
const intlSegmenterPolyfill = path.join(__dirname, 'node_modules/@formatjs/intl-segmenter/polyfill.js');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'multiformats/hashes/sha2' || moduleName === 'multiformats/dist/src/hashes/sha2-browser.js') {
    return { type: 'sourceFile', filePath: sha2Browser };
  }
  if (moduleName === '@formatjs/intl-segmenter/polyfill' || moduleName === '@formatjs/intl-segmenter/polyfill.js') {
    return { type: 'sourceFile', filePath: intlSegmenterPolyfill };
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
