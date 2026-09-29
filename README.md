# Wellness Class Presenter

This is the public static app bundle for GitHub Pages. The Supabase publishable key in `config.js` is designed for browser use; Row Level Security is configured in the separate private setup SQL. Never add a Supabase secret/service-role key here.

## Deploy

Upload the files in this folder to the root of `jikkund/healthand-welness`, then enable GitHub Pages from the `main` branch and `/ (root)`.

Students can use the shared app link without accounts to browse the roster, download each student's latest file beside their name, and preview PDF/PPTX presentations in the app. The teacher signs in and draws the active presenter; uploads and Canva links are filed for that presenter, so students cannot choose a name. Marking or undoing completion requires teacher sign-in and a fresh password check. Run the optional `public_student_access.sql` migration from the private setup folder to enable public submissions. Anyone with the link can submit a file or Canva link for the active presenter, and submitted files are visible to people with the link. Keep all private setup SQL files out of this public repository.
