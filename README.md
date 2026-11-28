<div align="center">

# MILAN

### Privacy-first decentralized social platform, built on Web5

**Your identity. Your data. Your rules.**

[Live App](https://milanlife.in) · [Architecture](DWN/docs/ARCHITECTURE.md) · [Security](DWN/docs/SECURITY.md)

![Web5](https://img.shields.io/badge/Web5-DID%20%2B%20DWN-6C47FF?style=for-the-badge)
![PWA](https://img.shields.io/badge/PWA-Installable-00C853?style=for-the-badge)
![Privacy](https://img.shields.io/badge/Privacy-First-111111?style=for-the-badge)
![Open Source](https://img.shields.io/badge/Open%20Source-Yes-blue?style=for-the-badge)

</div>

---

## What is MILAN?

MILAN is an open-source social platform where users own their identity and data. Instead of storing everything in one company's database, MILAN is built on the **Web5** stack: **Decentralized Identifiers (DIDs)** for identity and **Decentralized Web Nodes (DWNs)** for user-controlled data storage.

## Why Web5?

| Web2 | MILAN (Web5) |
|---|---|
| Platform owns your account | You own your **DID** |
| Data locked in company servers | Data lives in your **DWN** |
| Opaque data usage | Privacy-first by design |
| Platform lock-in | Portable identity |

- **DID (Decentralized Identifier):** a self-owned identity that no platform can revoke.
- **DWN (Decentralized Web Node):** a personal data store with message-based, permissioned access.

## Progressive Web App (PWA)

MILAN is a **Progressive Web App**: no app-store needed.

- Installable on Android, iOS, and desktop from the browser
- Service worker with offline support
- Fast, app-like experience with a web manifest and icons
- Single codebase for every device

## Features

- Decentralized identity (DID) based accounts
- Passkey / WebAuthn authentication
- Social: profiles, follow, feed
- Real-time chat
- Music
- MILAN Pay
- Installable PWA with offline page

## Architecture

~~~
MILAN/
├── frontend/   PWA client (HTML, CSS, JS, service worker, manifest)
├── backend/    Node.js API server
├── DWN/        Decentralized Web Node (C++, LevelDB / PostgreSQL storage)
└── staging/    Testing utilities
~~~

Details: [DWN/docs/ARCHITECTURE.md](DWN/docs/ARCHITECTURE.md)

## Quick Start

~~~bash
git clone https://github.com/Scrupulous-boy/MILAN.git
cd MILAN

# Backend
cd backend && npm install

# DWN (Docker)
cd ../DWN/docker && docker compose up -d
~~~

Copy `DWN/config/example.env` to `.env` and set your own values.

## Security

Never commit secrets or user data. See [DWN/docs/SECURITY.md](DWN/docs/SECURITY.md). Report vulnerabilities privately to the maintainer.

## Contributing

Issues and pull requests are welcome. Fork, create a branch, and open a PR.

## Founder

**Nitesh Pandey** · [LinkedIn](https://www.linkedin.com/in/nitesh-pandey-718923417)

---

<div align="center">

**MILAN** · Built for a user-owned web

</div>
