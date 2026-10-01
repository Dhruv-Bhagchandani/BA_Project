# BA_Project — OrderPilot: AI PO → Sales Order agent

An AI agent that converts messy customer purchase orders (PDFs, scans, phone photos, emails) into validated sales orders for a B2B textile distributor — auto-approving safe lines and routing risky ones to a human with a specific reason.

| Folder | Contents |
|---|---|
| [`app/`](app/) | The web app (Vite + React + TypeScript). Frontend-only, deploys to Vercel. **See [app/README.md](app/README.md).** |
| [`files/`](files/) | Synthetic relational dataset (catalogue, customers, history, POs, ground truth) + generator scripts and documentation |
| [`files (2)/`](files%20(2)/) | Raw-document benchmark (manifest, extraction ground truth, sample PO documents, render scripts). The full 1,000-document `po_documents.zip` is not committed (57 MB). |

## Run locally

```bash
cd app
npm install
npm run dev     # http://localhost:5173
```

## Deploy

Import this repo in Vercel and set **Root Directory = `app`**. No backend and no environment variables are required.

All data is synthetic and fictional.
