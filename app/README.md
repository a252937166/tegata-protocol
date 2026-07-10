# TEGATA web app

React 19 + Vite + wagmi/viem + Tailwind v4, English/日本語, light/dark.

Every PASS mark, hanko stamp and metric on the site renders the latest real
run of the shared verification core served by the API (`/api/showcase` →
`verification`); nothing is asserted in page source, and stale or errored
reports downgrade to pending. See the repository root README for the judge
paths and `docs/ARCHITECTURE.md` for how the pieces fit.

```bash
npm install
npm run dev     # :5173, proxies /api to :4033 (run the server first)
npm run build   # stamps the current git SHA into the footer
```
