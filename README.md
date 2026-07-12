# Personal Workflow Manager

This project turns the original standalone HTML dashboard into one shared workflow that both the dashboard and a Custom GPT can update.

## What is included

- The original black-and-orange dashboard, adapted for online saving
- A protected serverless API
- Supabase persistence
- A Custom GPT Action schema
- Single-user bearer-key authentication
- Local browser backup if the online API is temporarily unavailable

No OpenAI API key is used. The Custom GPT supplies the conversation intelligence, while this project only stores and updates workflow data.

## Free-tier accounts required

1. A free GitHub account
2. A free Supabase project
3. A free Vercel account
4. A ChatGPT plan that allows creating Custom GPTs

Provider limits and pricing can change. This personal dashboard is designed to remain far below normal free-tier usage.

## 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Paste and run the contents of `supabase.sql`.
4. Open **Project Settings → API** and copy:
   - Project URL
   - `service_role` key

Never put the service-role key inside the HTML or commit it to GitHub.

## 2. Create your private API key

Generate a long random value. On a terminal you can use:

```bash
openssl rand -hex 32
```

Keep this value private. It is the password used by your dashboard and Custom GPT.

## 3. Deploy through Vercel

1. Put this project in a private GitHub repository.
2. In Vercel, select **Add New → Project** and import the repository.
3. Add these environment variables in Vercel:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `WORKFLOW_API_KEY`
4. Deploy.
5. Open the Vercel URL and enter `WORKFLOW_API_KEY` when the dashboard asks.

The first visit imports the dashboard's default workflow into Supabase. Existing progress from the old Edge file is not automatically available because it lives in that browser's local storage. To preserve it, open the old file and the deployed dashboard in the same browser profile before clearing any browser data; a dedicated import/export migration can be added if needed.

## 4. Connect the Custom GPT

1. Open **Explore GPTs → Create** in ChatGPT.
2. Copy `gpt-instructions.md` into the GPT's Instructions field.
3. Enable an **Action**.
4. In `openapi.yaml`, replace:

   `https://YOUR-VERCEL-DOMAIN.vercel.app`

   with your actual Vercel domain.
5. Paste the complete edited `openapi.yaml` into the Action schema.
6. Set Authentication to **API Key**:
   - Authentication type: Bearer
   - Key: the same `WORKFLOW_API_KEY`
7. Save the GPT as **Only me**.

## 5. Test it

Ask the GPT:

> Read my workflow and tell me the current Clarification topics.

Then:

> Add “Validate willingness to pay” to the Clarification phase with a short description and two activities.

Refresh the dashboard. The new topic should appear.

## Security

- The Supabase table has Row Level Security enabled and no public access policy.
- The service-role key exists only in Vercel environment variables.
- Every API request must contain your private bearer key.
- Keep the GPT private and never share its action credential.
- If the key is exposed, create a new one and update Vercel and the GPT Action.

## Local verification

```bash
npm install
npm test
```

For local end-to-end use, install the Vercel CLI through the included dependency, create `.env.local` from `.env.example`, and run:

```bash
npm run dev
```
