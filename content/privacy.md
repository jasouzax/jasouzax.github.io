# Privacy

This site stores your theme choice in your browser. Tools in `/desk` run locally and do not upload your files.

Messages in `/work` are encrypted in your browser with a key shared between you and the project owner. The service stores encrypted messages, your email address, the sender role and message timestamps in Cloudflare D1. It stores a hash of your invitation access token. Message contents and shared encryption keys are not sent to the service as plaintext.

Your invitation contains both access credentials and the shared key. After opening it, this tab keeps them in browser session storage and removes them from the address bar. The emergency owner access token and unsent drafts stay in memory. Keep invitations private and back up the shared key: the service cannot recover it. Google sign-in does not recover encryption keys. Locking the workspace signs out and clears the tab's stored invitations. Attachments and automatic email notifications are not currently implemented.

When you choose Google sign-in, Google provides your verified email address, name and account identifier. The service stores these in D1, together with a hash of an opaque session token. Your browser receives an HttpOnly, Secure, SameSite=Lax session cookie; sessions expire after thirty idle days. Google ID tokens are verified server-side; Google access/ID tokens are not retained. A temporary ten-minute HttpOnly cookie and short-lived database record protect the sign-in flow. Once you link a conversation to your Google account, that account is required to access it. Signing out revokes the current session.
