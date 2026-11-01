// Windows has a 260-character path limit (unless LongPathsEnabled is set, which needs admin rights).
// React Native codegen and llama.rn produce very deep C++ object paths, so the build fails with
// "Filename longer than 260 characters". Expo's Gradle plugin passes CMAKE_OBJECT_PATH_MAX to every
// CMake module (default 1024); 128 makes CMake replace long object directory names with short
// hashes. Harmless on macOS/Linux.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'expo.android.cmakeObjectPathMax';

module.exports = function withShortNativePaths(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((item) => !(item.type === 'property' && item.key === KEY));
    cfg.modResults.push({ type: 'property', key: KEY, value: '128' });
    return cfg;
  });
};
