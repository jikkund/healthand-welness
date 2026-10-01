# Wellness Class · Student Progress

Static GitHub Pages app. Students can view the roster and completion status without signing in; teacher controls require the teacher account. Supabase remains the source of completion status and authorized actions.

## Optional live roster from Google Sheets

Names load from the published `Public Roster` sheet as CSV. Keep the source worksheet unpublished: it also contains topics and presentation links. The public roster feed exposes only roll numbers and student names to anyone with the app link. The app matches roster rows to Supabase by roll number; each roll must exist in the `students` table for picker/status actions to work.

The app falls back to Supabase names while the CSV setting is blank. Never place a Supabase secret/service-role key in this folder.

## Teacher confirmation and passkeys

Teacher actions now use a themed in-app confirmation window. The teacher can confirm with their password or a device passkey (fingerprint, face unlock, device PIN, or security key). To enroll a passkey, sign in as the teacher and choose **Set up passkey**. Supabase Passkeys must first be enabled in the project dashboard under Authentication → Passkeys, with the WebAuthn relying-party origin configured for the deployed site (`https://jikkund.github.io`). Supabase currently labels passkey support experimental; until it is enabled and a passkey is enrolled, use the password option.
