<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,20,24&height=220&section=header&text=MILAN&fontSize=84&fontColor=ffffff&animation=fadeIn&desc=Your%20identity.%20Your%20data.%20Your%20rules.&descSize=20&descAlignY=72" alt="MILAN" width="100%"/>

### Privacy-first decentralized social platform, built on Web5

<p>
<a href="https://milanlife.in"><img src="https://img.shields.io/badge/Live-milanlife.in-6C47FF?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live"/></a>
<img src="https://img.shields.io/badge/Web5-DID%20%2B%20DWN-111111?style=for-the-badge" alt="Web5"/>
<img src="https://img.shields.io/badge/PWA-Installable-00C853?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA"/>
<img src="https://img.shields.io/badge/Open%20Source-Yes-0A84FF?style=for-the-badge&logo=github&logoColor=white" alt="Open Source"/>
</p>

<p>
<img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="JavaScript"/>
<img src="https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js"/>
<img src="https://img.shields.io/badge/C++-00599C?style=flat-square&logo=cplusplus&logoColor=white" alt="C++"/>
<img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
<img src="https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker"/>
<img src="https://img.shields.io/badge/Nginx-009639?style=flat-square&logo=nginx&logoColor=white" alt="Nginx"/>
<img src="https://img.shields.io/badge/WebAuthn-Passkeys-FF6A00?style=flat-square" alt="WebAuthn"/>
</p>

[**Live App**](https://milanlife.in) &nbsp;·&nbsp; [**Architecture**](DWN/docs/ARCHITECTURE.md) &nbsp;·&nbsp; [**Security**](DWN/docs/SECURITY.md) &nbsp;·&nbsp; [**Troubleshooting**](DWN/docs/TROUBLESHOOTING.md)

</div>

---

## Overview

**MILAN** is an open-source social platform where **you own your identity and your data**. Instead of keeping everything in one company's database, MILAN is built on the **Web5** stack:

- **DID (Decentralized Identifier):** a self-owned identity that no platform can revoke.
- **DWN (Decentralized Web Node):** a personal data store with message-based, permissioned access.

It ships as a **Progressive Web App**, so it installs on any device straight from the browser, with no app store needed.

## Why MILAN

| | Traditional social media | MILAN |
|---|---|---|
| **Identity** | Platform owns your account | You own your **DID** |
| **Data** | Locked in company servers | Stored in your **DWN** |
| **Privacy** | Opaque data usage | Privacy-first by design |
| **Portability** | Platform lock-in | Portable identity |
| **Install** | App store only | Installable **PWA** |

## Features

| | | |
|---|---|---|
| **Decentralized Identity**<br>DID-based accounts | **Passkeys**<br>WebAuthn authentication | **Social**<br>Profiles, follow, feed |
| **Chat**<br>Real-time messaging | **Music**<br>Built-in music player | **MILAN Pay**<br>UPI-based payments |
| **PWA**<br>Install on Android, iOS, desktop | **Offline mode**<br>Service worker + offline page | **Open Source**<br>Fork it, audit it, improve it |

## Progressive Web App

- Installable from the browser on Android, iOS and desktop
- Service worker with offline support
- Web manifest with full icon set
- Single codebase for every device
- Fast, app-like experience

## Architecture

~~~mermaid
flowchart LR
    U[User / PWA] -->|HTTPS| N[Nginx]
    N --> B[Backend API<br/>Node.js]
    N --> F[Frontend<br/>PWA assets]
    B --> D[DWN<br/>C++ server]
    D --> L[(LevelDB)]
    D --> P[(PostgreSQL)]
    U -. DID + Passkey .-> B
~~~

## Project Structure

~~~
MILAN/
├── frontend/   PWA client (HTML, CSS, JS, service worker, manifest)
├── backend/    Node.js API server
├── DWN/        Decentralized Web Node (C++, LevelDB / PostgreSQL)
│   ├── src/        server, auth, DID, records, storage
│   ├── include/    public headers
│   ├── docs/       architecture, database, security
│   ├── docker/     Dockerfile + docker-compose
│   └── tests/      unit + integration tests
└── staging/    testing utilities
~~~

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

## Documentation

| Doc | What's inside |
|---|---|
| [Architecture](DWN/docs/ARCHITECTURE.md) | System design |
| [Database](DWN/docs/DATABASE.md) | Storage layer |
| [Security](DWN/docs/SECURITY.md) | Security model |
| [Full README](DWN/docs/README_FULL.md) | Complete DWN guide |
| [Troubleshooting](DWN/docs/TROUBLESHOOTING.md) | Common issues |

## Security

Never commit secrets or user data. Report vulnerabilities privately to the maintainer instead of opening a public issue.

## Contributing

Contributions are welcome.

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Commit and push your changes
4. Open a Pull Request

## Founder

**Nitesh Pandey** &nbsp;·&nbsp; [LinkedIn](https://www.linkedin.com/in/nitesh-pandey-718923417) &nbsp;·&nbsp; [GitHub](https://github.com/Scrupulous-boy)

---

<div align="center">

**MILAN** · Built for a user-owned web

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=12,20,24&height=100&section=footer" width="100%" alt=""/>

</div>
