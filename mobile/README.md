# Shotor AI: offline mobile app

A private executive assistant for Android and iPhone. The AI runs **on the phone** through [llama.rn](https://github.com/mybigday/llama.rn), which is llama.cpp, the engine inside Ollama. There is no server and no API key, and reports and chats never leave the device.

| Feature | Works offline? |
|---|---|
| Report summaries (PDF, Word, PowerPoint, Excel, pasted text) | ✅ |
| AI chat about meetings, mail and reports | ✅ |
| Daily brief | ✅ |
| Meeting reminders (from the phone's calendar: Google, Outlook, iCloud) | ✅ |
| Reading mail (last 7 days, cached) | ✅ |
| AI reply drafts | ✅ |
| Sending mail | Queued in the Outbox and sent automatically when back online |
| First-time model download (about 2 GB) | Needs internet once, or import a `.gguf` file offline |

## How it works
```
Phone app (Expo / React Native)
 ├─ llama.rn ─────────── GGUF model in app storage (Llama 3.2 3B by default)
 ├─ expo-sqlite ──────── reports, chat, cached mail, outbox, briefs
 ├─ pdf.js (hidden WebView, bundled) + JSZip ── document text extraction
 ├─ expo-calendar + expo-notifications ── meeting reminders, daily brief alert
 └─ Gmail REST API (OAuth PKCE on device) ── only network traffic, only when online
```
Code map:
- `src/app/`: screens (Expo Router)
- `src/lib/ai/`: model catalog/download, inference engine and prompts
- `src/lib/gmail/`: sign-in, sync and outbox
- `src/lib/db.ts`: database
- `src/components/Brand.tsx`: the Aether Link logo as SVG

## Requirements
- Node.js 20+ (24 LTS tested)
- **Android:** JDK 17 and Android SDK 37 / NDK 27.1. Android Studio installs both.
- **iPhone:** a Mac with Xcode, or Expo EAS cloud builds. Either way you need an Apple Developer account ($99/yr).
- Phones: Android 8+ (arm64) or iOS 16+. **6 GB RAM or more** is recommended for the 3B model. Use the 1B model on older phones.

## Install dependencies
```bash
cd mobile
npm install
# llama.rn downloads its prebuilt native libraries in a postinstall script. Newer npm versions block
# install scripts by default; if node_modules/llama.rn/android/src/main/jniLibs is missing, run:
node node_modules/llama.rn/install/download-native-artifacts.js
```

## Build the Android APK (to send directly)
```bash
cd mobile
npx expo prebuild --platform android --clean
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -PrnllamaVariants=rnllama,rnllama_v8_2_dotprod,rnllama_v8_2_dotprod_i8mm      # Windows: gradlew.bat ...
# → android/app/build/outputs/apk/release/app-release.apk
```
**Building on Windows: read this first**
- **Path length:** the C++ build creates very deep paths and fails with *"Filename longer than 260 characters"* when the project or Android SDK lives in a long folder. Map short drive letters before building, and run every command from them:
  ```bat
  subst P: C:\path\to\Shotor-AI\mobile
  subst S: C:\path\to\android-tools
  ```
  Here `S:` holds `android-sdk` and `jdk17`, so set `ANDROID_HOME=S:\android-sdk` and `JAVA_HOME=S:\jdk17`. Run `npx expo prebuild --clean` from `P:\` after mapping, so the generated paths are short too.
- **llama.rn compiles from source:** the version in use forces a source build, about 1,000 C++ files per CPU variant. Build only three variants (the app falls back automatically on other CPUs):
  `-PrnllamaVariants=rnllama,rnllama_v8_2_dotprod,rnllama_v8_2_dotprod_i8mm`
- An unstable internet connection causes *"No such host is known"* during the first build. Re-run the build; Gradle keeps what it already downloaded.

Send `app-release.apk` by link, email, WhatsApp or USB. On the phone: open it, allow **Install unknown apps** for that app once, then tap Install.

### Release signing (important for updates)
Android only installs an update over an existing app if both are signed with **the same key**. Release builds use `credentials/shotor-release.jks` and its passwords in `credentials/keystore.properties`. Both are git-ignored. **Back up the `credentials/` folder somewhere safe** (a password manager or company vault). If it is lost, users must uninstall and reinstall to update, which deletes their data.

To create a new key (only if you have none):
```bash
keytool -genkeypair -storetype PKCS12 -keystore credentials/shotor-release.jks -alias shotor -keyalg RSA -keysize 4096 -validity 10000
# then write credentials/keystore.properties:
#   storeFile=shotor-release.jks
#   storePassword=...
#   keyAlias=shotor
#   keyPassword=...
```
If `keystore.properties` is missing, release builds are signed with the debug key. That's fine for testing only.

## iPhone (without the App Store)
Apple does not allow free sideloading. These are the options for a few CEO/manager phones:

| Option | What you need | Notes |
|---|---|---|
| **Ad Hoc** (recommended) | Apple Developer account ($99/yr) | Register each iPhone's UDID (up to 100). Install from a link. Re-sign yearly. |
| **TestFlight** | Same account | Users install through the TestFlight app. Each build expires after 90 days. |
| Custom App (Apple Business Manager) | Same account plus ABM | Private, reviewed by Apple, distributed only to the client's organization. |

Building without a Mac uses Expo's cloud build:
```bash
npx eas-cli@latest login
npx eas-cli@latest device:create          # register each iPhone (sends a link to open on the phone)
npx eas-cli@latest build -p ios --profile adhoc
# EAS prints an install link/QR code for the registered iPhones.
```
llama.rn's iOS plugin requests the *increased memory limit* entitlement. EAS enables it on the App ID automatically when it manages credentials. If you manage certificates yourself, enable it in the Apple Developer portal.

## Gmail setup (optional)
Mail features need a Google OAuth client. Everything else works without it.
1. In Google Cloud Console, create a project, then enable the **Gmail API**.
2. Set up the OAuth consent screen. If the client uses **Google Workspace**, choose **Internal**: it needs no Google verification, and sign-ins don't expire. With an *External* app in *Testing* mode, Google expires sign-ins **every 7 days**, and publishing it requires Google's restricted-scope verification.
3. Create credentials → OAuth client ID → type **iOS** with bundle ID `com.aetherlink.shotor`. This one client is used on both Android and iPhone.
4. Build with the client ID:
   ```bash
   GOOGLE_IOS_CLIENT_ID=1234-abcd.apps.googleusercontent.com npx expo prebuild --clean   # then build as above
   ```
   For EAS, add `GOOGLE_IOS_CLIENT_ID` as an EAS environment variable.

Scopes are `gmail.readonly` and `gmail.send`. Tokens are stored in the phone's secure keystore (Keychain / Android Keystore).

## AI models
Pick one in **Settings → AI model**. Models download from Hugging Face over Wi-Fi.

| Model | Size | RAM | Use |
|---|---|---|---|
| Llama 3.2 3B (default) | 2.0 GB | 6 GB+ | Best balance |
| Gemma 3 4B | 2.5 GB | 8 GB+ | Best writing |
| Qwen 3 4B | 2.5 GB | 8 GB+ | Structured/multilingual |
| Llama 3.2 1B | 0.8 GB | 3 GB+ | Older phones |

**Fully offline install:** copy a `.gguf` file to the phone (USB, AirDrop or Files), then use **Import .gguf file**.

## Development
```bash
npm run typecheck
npx expo run:android          # dev build on a device/emulator (Expo Go is not supported: native modules)
npm run gen:pdfjs             # after upgrading pdfjs-dist
npm install --no-save sharp && npm run gen:icons   # after changing the logo
```

## Security notes
- All data is stored in the app's private storage. Android cloud backup is disabled.
- Optional app lock uses Face ID / fingerprint and locks again after 1 minute in the background.
- Mail and document text is treated as untrusted. Prompts fence it off and tell the model not to follow instructions inside it. Replies are never sent without the user tapping **Approve & send**.
- **Settings → Erase all data** removes reports, chat, mail cache, the outbox and briefs.
