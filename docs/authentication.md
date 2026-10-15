Language: EN | [简中](authentication.zh-CN.md)

# Recordly authentication setup

Google sign-in and Drive use desktop OAuth directly, without Supabase. Import a Google Desktop app client JSON in Recordly; see [desktop Google setup (简中)](google-drive.zh-CN.md). The Supabase instructions below apply only to optional email, Microsoft, GitHub and legacy cloud services. Their session is separate from the native Google account.

## 1. Create the project

1. Create a Supabase project.
2. In **Project settings → API**, copy the project URL and publishable key.
3. Copy `.env.example` to `.env.local` and fill in both values. Never use the service-role key in the desktop application.
4. In **Authentication → URL configuration**, add `recordly://auth/callback` and `http://127.0.0.1:43821/auth/callback` to the redirect allow list.

Email/password works once email authentication is enabled and a user has been created. Password-reset emails use the same desktop callback.

## 2. Google

Create a **Desktop app** OAuth client, enable Drive API and add your test email to the test audience. Import the downloaded JSON in Recordly. Follow the [desktop setup guide (简中)](google-drive.zh-CN.md); no Supabase callback, Edge Function, server-side OAuth secret or connection migration is required.

## 3. X

1. Create an OAuth 2.0 app in the X Developer Dashboard and enable requesting the user's email.
2. Set its callback URL to `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
3. Enable X/Twitter OAuth 2.0 in Supabase and paste the client ID and secret.

## 4. SAML SSO (currently hidden)

SAML is configured per customer workspace. Supabase's SAML support requires Pro or above.

1. Enable SAML in the Supabase Auth provider settings.
2. Obtain the customer's IdP metadata URL or metadata XML file.
3. Register the connection and its email domain with the Supabase CLI, for example:

   ```sh
   supabase sso add --type saml --project-ref YOUR_PROJECT_REF \
     --metadata-url 'https://customer.example/idp/metadata' \
     --domains customer.example
   ```

The Recordly modal extracts the domain from the entered email address and starts the matching SAML connection.

## 5. Verify locally

Restart `npm run dev` after creating `.env.local`. Open an editor and verify:

1. The account button opens **Sign into Recordly**.
2. Email/password creates a persistent Supabase session.
3. Google opens the system browser and returns to Recordly.
4. Clicking **Create link** while signed out opens this modal; after successful authentication it continues to the share dialog.

Add the same `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values to the share Worker's secrets or variables. Set `OWNER_USER_ID` to the owner’s Supabase user ID. The Worker validates the access token with Supabase and requires that owner identity before accepting API requests. `API_SECRET` is server-side only and remains available for library administration and explicitly enabled local integration tests; it is never entered into or exposed by the desktop app.
