# Privacy

This site stores your theme choice in your browser. Tools in `/desk` run locally and do not upload your files.

Messages in `/work` are encrypted in your browser with a key shared between you and the project owner. The service stores encrypted messages, your email address, the sender role and message timestamps in Cloudflare D1. It stores a hash of your invitation access token. Message contents and shared encryption keys are not sent to the service as plaintext.

Your invitation contains both access credentials and the shared key. After opening it, this tab keeps them in browser session storage and removes them from the address bar. The owner access token and unsent drafts stay in memory. Keep invitations private and back up the shared key: the service cannot recover it. Locking the workspace clears the tab's stored invitations. The current messaging version does not use account/session cookies, attachments or automatic email notifications.
