# AgentZero

AI copilot for real estate agents. Agents talk to AgentZero on **WhatsApp** (Twilio). The **web console** (`/copilot`) is for connect/upload/configure. Outbound voice is **Vapi**. Lead inbox memory is **Meta Cloud Coexistence**.

This repo also still contains an older Dubai listings / VerifyPro surface. AgentZero rules live in the docs below — not in that dashboard code.

## Docs

| File | What it is |
| --- | --- |
| [docs/AGENTS.md](docs/AGENTS.md) | Standing contract: auth, multi-tenant rules, Jarvis ownership, Morning Brief, hard constraints |
| [docs/backend-scripts-prompt.md](docs/backend-scripts-prompt.md) | Scripts / dial path / Vapi (wins on those topics) |
| [docs/web-console-spec.md](docs/web-console-spec.md) | Console screens Scripts does not own |
| [README-COEXISTENCE.md](README-COEXISTENCE.md) | Meta WhatsApp Cloud coexistence runbook |
| [.env.example](.env.example) | Environment variables |

## Local

```bash
npm install
# copy .env.example → .env.local and fill values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). **Log in** on the landing page goes to `/copilot`.
