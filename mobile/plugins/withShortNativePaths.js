// Windows has a 260-character path limit (unless LongPathsEnabled is set, which needs admin rights).
// React Native codegen and llama.rn produce very deep C++ object paths, so the build fails with
// "Filename longer than 260 characters". CMAKE_OBJECT_PATH_MAX makes CMake replace long object
// directory names with short hashes. It is harmless on macOS/Linux.
const { withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// shotor-short-native-paths';
const SNIPPET = `
${MARKER}
subprojects { sp ->
  ['com.android.application', 'com.android.library'].each { pluginId ->
    sp.plugins.withId(pluginId) {
      sp.android.defaultConfig.externalNativeBuild.cmake.arguments("-DCMAKE_OBJECT_PATH_MAX=128")
    }
  }
}
`;

module.exports = function withShortNativePaths(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += SNIPPET;
    return cfg;
  });
};
