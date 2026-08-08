# Legal Annotator v2 — Setup Guide

## Step 1: Add `drive_file_id` column to Supabase

Your `pdf_files` table needs a new column for Google Drive file IDs.

1. Go to your [Supabase dashboard](https://supabase.com/dashboard)
2. Open your project → click **SQL Editor** (left sidebar)
3. Paste and run this:

```sql
-- Add Google Drive file ID column
ALTER TABLE pdf_files ADD COLUMN IF NOT EXISTS drive_file_id TEXT;

-- Add sort_order for drag-to-reorder support
ALTER TABLE pdf_files ADD COLUMN IF NOT EXISTS sort_order NUMERIC;

-- Add linked_pdf_id to support PDF shortcuts across folders
ALTER TABLE pdf_files ADD COLUMN IF NOT EXISTS linked_pdf_id TEXT REFERENCES pdf_files(id) ON DELETE CASCADE;

-- PDF Notepad table (general notes per PDF)
CREATE TABLE IF NOT EXISTS pdf_notes (
  pdf_id  TEXT PRIMARY KEY REFERENCES pdf_files(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- (Optional but recommended) Add cascade delete for cleaner data
-- This auto-deletes annotation_notes when annotations are deleted
ALTER TABLE annotation_notes DROP CONSTRAINT IF EXISTS annotation_notes_annotation_id_fkey;
ALTER TABLE annotation_notes ADD CONSTRAINT annotation_notes_annotation_id_fkey
  FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE;

-- Auto-delete annotations when PDF is deleted
ALTER TABLE annotations DROP CONSTRAINT IF EXISTS annotations_pdf_file_id_fkey;
ALTER TABLE annotations ADD CONSTRAINT annotations_pdf_file_id_fkey
  FOREIGN KEY (pdf_file_id) REFERENCES pdf_files(id) ON DELETE CASCADE;
```

4. Click **Run** ✅

---

## Step 2: Get Google Cloud Client ID (FREE — no billing needed)

> ⚠️ This is completely free. No credit card required.

### 2a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. At the top, click the project dropdown → **New Project**
3. Name it `Legal Annotator` → click **Create**

### 2b. Enable Google Drive API

1. In the left menu, go to **APIs & Services → Library**
2. Search for **Google Drive API**
3. Click on it → click **Enable**

### 2c. Configure OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → click **Create**
3. Fill in:
   - App name: `Legal Annotator`
   - User support email: your Gmail
   - Developer contact email: your Gmail
4. Click **Save and Continue** (skip Scopes, skip Test users)
5. Click **Back to Dashboard**

### 2d. Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**
2. Click **+ Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Legal Annotator Web`
5. Under **Authorized JavaScript origins**, add:
   - `http://localhost` (for local use)
   - `http://localhost:5173` (if using a local server)
   - `file://` won't work — see Step 3 for running locally
6. Click **Create**
7. A popup shows your **Client ID** — it looks like: `123456789-abc123.apps.googleusercontent.com`
8. **Copy it**

---

## Step 3: Add your Client ID to the app

1. Open `d:\Code\legal-annotator\index.html`
2. Find this line near the top:
   ```js
   GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID_HERE',
   ```
3. Replace `YOUR_GOOGLE_CLIENT_ID_HERE` with your Client ID

---

## Step 4: Run the app

Because we use ES modules (`type="module"`), you **cannot** just open `index.html` by double-clicking it — browsers block ES modules from `file://` URLs for security.

### Option A: Use VS Code Live Server (easiest)
1. Install [VS Code](https://code.visualstudio.com) if you don't have it
2. Install the **Live Server** extension (search in Extensions panel)
3. Right-click `index.html` → **Open with Live Server**
4. The app opens at `http://127.0.0.1:5500/legal-annotator/`

### Option B: Install Node.js and use a simple server
1. Install [Node.js](https://nodejs.org) (LTS version)
2. Open PowerShell in `d:\Code\legal-annotator\`
3. Run: `npx -y serve .`
4. Open the URL it shows

### Option C: Install Python and use its built-in server
1. If Python is installed, run in PowerShell:
   ```
   python -m http.server 8080
   ```
2. Open `http://localhost:8080` in your browser

> After setup, also add your server URL (e.g. `http://127.0.0.1:5500`) to the
> **Authorized JavaScript origins** in Google Cloud Console (Step 2d).

---

## That's it! 🎉

Once running:
1. Open the app → click **Sign in** in the Drive bar
2. Authorize with your Google account
3. Create a Subject → Add a Folder → Upload a PDF
4. PDFs go to Google Drive, annotations go to Supabase

Your PC and laptop will both see the same data as long as they're signed in to the same Google account and Supabase project.
