# Manual test plan

Use synthetic users and test Google accounts only. Do not send real email during normal tests.

1. Register user A with a 12+ character password; verify login and `/api/v1/auth/me`.
2. Log out; verify the previous access token receives 401.
3. Register user B. Upload a TXT file as A; verify B cannot read, summarize, or delete it.
4. Upload valid PDF, TXT, and DOCX files. Verify unsupported, empty, malformed, encrypted, and oversized files fail safely.
5. Configure Ollama and pull the selected model. Summarize a document and ask the assistant a question. Stop Ollama and verify a helpful 503/504 response.
6. Configure Google OAuth test credentials and callback URI. Connect, cancel consent, reconnect, and verify status and disconnect.
7. Review Gmail messages and details. Generate a reply, edit recipient/subject/body, cancel, then confirm send only to a test inbox. Verify second send is rejected. Check Gmail Sent if a send attempt has an ambiguous timeout.
8. Create test Calendar events with explicit time zones, refresh events, verify reminders are scheduled 30 minutes before eligible events, disconnect Google, and verify scheduled reminder work is cancelled.
9. Delete account with wrong password (must fail), then correct password (must succeed). Verify token invalidation and removal of documents, drafts, sessions, and Google connection records.
10. Install the release variant only after configuring HTTPS. Verify cleartext HTTP is disabled for release builds.
