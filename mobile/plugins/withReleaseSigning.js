// Signs Android release builds with your own keystore so installed apps can be updated in place.
// Reads from mobile/credentials/keystore.properties (git-ignored):
//   storeFile=shotor-release.jks
//   storePassword=...
//   keyAlias=shotor
//   keyPassword=...
// If the file is missing, release builds fall back to the debug key (fine for testing only).
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// shotor-release-signing';

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const loader = `
${MARKER}
def shotorKeystoreProps = new Properties()
def shotorKeystoreFile = rootProject.file("../credentials/keystore.properties")
if (shotorKeystoreFile.exists()) { shotorKeystoreFile.withInputStream { shotorKeystoreProps.load(it) } }
`;
    gradle = gradle.replace(/android\s*\{/, `${loader}\nandroid {`);

    gradle = gradle.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        release {
            if (shotorKeystoreFile.exists()) {
                storeFile rootProject.file("../credentials/" + shotorKeystoreProps["storeFile"])
                storePassword shotorKeystoreProps["storePassword"]
                keyAlias shotorKeystoreProps["keyAlias"]
                keyPassword shotorKeystoreProps["keyPassword"]
            }
        }`,
    );

    // In the release build type, use the release key when it is configured.
    gradle = gradle.replace(
      /(release\s*\{[^{}]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig shotorKeystoreFile.exists() ? signingConfigs.release : signingConfigs.debug`,
    );
    cfg.modResults.contents = gradle;
    return cfg;
  });
};
