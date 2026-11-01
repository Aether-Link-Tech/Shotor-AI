# Shotor AI Assistant Privacy Policy — publication template

**Do not publish this template unchanged.** Replace every bracketed field and ensure every statement matches the deployed application and its hosting, logging, backups, and AI-provider configuration.

- Operator: [legal name]
- Contact: [privacy/support email]
- Effective date: [date]

## Data processed
Shotor may process account email address and name, password hash, session records, uploaded document files and extracted text, generated summaries, user prompts and AI responses, Gmail message content required for selected features, Google Calendar event details required for reminders, and limited operational diagnostics.

## Purpose and providers
Account data is used to authenticate users and provide the requested features. Uploaded text and user prompts are sent from the backend to the configured Ollama endpoint to generate summaries and responses. If a hosted Ollama-compatible provider is configured, that provider may process the submitted content under its terms. When a user connects Google, Shotor uses the granted OAuth permissions to access Gmail and Calendar data for that user. AI-generated email replies remain drafts until the user edits/reviews and explicitly confirms sending.

## Storage and security
Passwords are hashed. Access tokens are short-lived and server-side sessions can be revoked. Google refresh tokens are encrypted at rest. Uploaded originals are stored in private server-side storage, not a public static directory. No security measure is perfect; operators must document the actual hosting region, encryption, backup, log retention, and access controls before publication.

## Sharing and retention
Data is shared only with service providers necessary to operate requested features, such as the configured AI endpoint, Google APIs, and infrastructure providers. The operator must list actual providers and retention periods here. Shotor account data is intended to be deleted through in-app account deletion; external Google revocation is attempted, and Google may retain its own records under Google's policies. Backups and security logs may have separate documented retention periods.

## User choices
Users may disconnect Google or delete their Shotor account in the Android app. A public account-deletion request URL must also be published for users who cannot access the app: [public HTTPS deletion URL]. Users can revoke Shotor's Google access in their Google Account security settings.

## Children and changes
[Describe the intended audience and applicable age rules.] This policy may be updated; the operator should publish the effective date and notify users when legally required.
