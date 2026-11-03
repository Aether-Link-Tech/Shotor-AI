// Adds "Shotor AI" to Android's Share menu for documents and text, so a report can be sent
// straight from WhatsApp, Gmail, Files or Drive. The shared item is read by the ShotorBackground module.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/*',
];

module.exports = function withShareTarget(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const filters = (activity['intent-filter'] = activity['intent-filter'] || []);
    const isShare = (f) => (f.action || []).some((a) => a.$['android:name'] === 'android.intent.action.SEND');
    activity['intent-filter'] = filters.filter((f) => !isShare(f));
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: MIME_TYPES.map((m) => ({ $: { 'android:mimeType': m } })),
    });
    return cfg;
  });
};
