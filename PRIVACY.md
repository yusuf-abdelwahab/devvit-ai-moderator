# Privacy policy draft

This app is a moderator tool. It processes Reddit posts, comments, and moderator mail that are presented to the installed app through Reddit's moderation capabilities. Content may be sent to Google Gemini for moderation analysis and stored as embeddings in the configured Supabase database.

The app does not request Reddit passwords or independent Reddit OAuth credentials. API credentials for Gemini and Supabase are stored as developer-managed secret settings.

Private moderator rules may be added via JSON file udner /policy/private/...
