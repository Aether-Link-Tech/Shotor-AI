# Connecting Gmail to Shotor AI

*For: whoever manages the Google account (about 15 minutes, done once)*

The Mail tab signs in to Gmail **on the phone**. Google needs to know the app first, so you create an "OAuth client ID" in Google Cloud and put it into the app build. No password or secret is stored in the app.

## 1. Create the Google Cloud project
1. Open https://console.cloud.google.com and sign in with the Google account that will own the app. For a company, use a Workspace admin account.
2. Click the project picker at the top, then **New project**. Name it `Shotor AI` and click **Create**.
3. Go to **APIs & Services → Library**, search **Gmail API**, and click **Enable**.

## 2. Consent screen (who may sign in)
Go to **APIs & Services → OAuth consent screen** (in newer consoles, **Google Auth Platform → Branding / Audience**).
- **App name:** Shotor AI. **Support email:** yours.
- **Audience / User type**:
  - **Google Workspace company** (emails like `name@company.com` hosted by Google): choose **Internal**. No Google review is needed, and sign-ins never expire. ✅ Best option.
  - **Personal Gmail** (`@gmail.com`): choose **External**, then:
    - Add each user's Gmail address under **Test users** (up to 100).
    - ⚠️ While the app is in **Testing**, Google signs users out of Gmail **every 7 days**, and they tap **Connect Gmail** again. To avoid this, click **Publish app**. Google then shows users a one-time *"Google hasn't verified this app"* screen (they tap **Advanced → Go to Shotor AI**). This works for up to 100 users without Google's paid security review.
- **Scopes / Data access:** add `gmail.readonly` and `gmail.send`.

## 3. Create the client ID
1. **APIs & Services → Credentials → Create credentials → OAuth client ID.**
2. **Application type: iOS.** Use iOS even for Android: this app uses the same client on both platforms.
3. **Bundle ID:** `com.aetherlink.shotor`
4. Click **Create** and copy the **Client ID**. It looks like `123456789-abc123.apps.googleusercontent.com`.

## 4. Put it into the app
1. Open the GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `GOOGLE_IOS_CLIENT_ID`. **Value:** the Client ID. Save.
3. Rebuild the app. Any push to `main` does this, or go to **Actions → Mobile app (Android APK) → Run workflow**.
4. Sign the new APK as usual and install it over the old one.

## 5. On the phone
Open **Mail → Connect Gmail**, choose the account, and allow access. Shotor then downloads the last 7 days of mail for offline reading. AI reply drafts are only sent after you tap **Approve & send**. When offline, they wait in the Outbox.

### Troubleshooting
| Message | Fix |
|---|---|
| "Gmail is not enabled in this build" | The secret is missing, or the APK was built before it was added. Rebuild. |
| "Access blocked: app not verified" or "not a test user" | Add the address under **Test users**, or publish the app (step 2). |
| "Google sign-in expired. Please reconnect" | The app is in **Testing** mode (7-day limit). Publish it, or use Internal. |
