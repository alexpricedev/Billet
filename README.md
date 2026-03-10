<!-- LOGO -->
<p align="center">
  <img src="public/logo.png" alt="Billet Logo" width="180" />
</p>

<h1 align="center">Billet</h1>

<p align="center">
  <b>Full-stack TypeScript starter designed to be built on by AI coding agents</b>
  <br />
  Server-rendered JSX, light-touch JS, Tailwind CSS — one codebase, one deploy target.<br />
  Deterministic templates with strong types that AI agents can reason about and test with confidence.
</p>

<p align="center">
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals"><img src="https://img.shields.io/badge/JSX/TSX-20232a?style=for-the-badge&logo=javascript&logoColor=yellow" alt="JSX/TSX" /></a>
  <a href="https://typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://railway.app"><img src="https://img.shields.io/badge/Deploy%20on-Railway-131415?style=for-the-badge&logo=railway&logoColor=white" alt="Railway" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
</p>

---

## Why Billet?

> **Billet** (noun): A semi-finished piece of steel, shaped and ready to be worked into something specific. Named for Sheffield — the Steel City, where crucible steel was invented.

Left to their own choices, AI coding agents will reach for what they know best: React with Next.js. The result is a thick-frontend app split across client and server, locked into a specific ecosystem, requiring multiple test systems to simulate browser state, and unnecessarily complex and costly to deploy.

Billet takes the opposite approach. It's a single-instance server-rendered app with light-touch client-side JavaScript. Templates are deterministic functions of their props — given the same input, they produce the same HTML. This makes them trivial to test in a single unified system without browser simulation. One codebase, one test runner, one deploy target.

This isn't a limitation. It's a deliberate architectural choice that plays to AI's strengths: strong type information to reason about, functional input/output patterns, and a feedback loop (write code → run tests → see results) that works in seconds, not minutes.

---

## 🚀 Features

- **Bun-powered**: Lightning-fast dev/build with Bun
- **Familiar JSX/TSX templating**: Use the syntax you know, but not tied to any framework
- **Web standards first**: Embraces native HTML, CSS, and JavaScript
- **Separation of concerns**: Encourages clean, maintainable code structure
- **Modern frontend tooling**: Integrates with your favorite tools and workflows
- **Web components support**: Use or author custom elements natively
- **Opt-in React**: Use React only where you need it—per page
- **Server-side rendering**: TSX-based static/server components
- **HTML streaming**: Powered by `react-dom/server` in Bun
- **TypeScript-first**: Everything is written in TS and wired up by Bun
- **Easy deploy**: Instantly deployable to Railway

---

## 🏁 Quick Start

```bash
bun install
bun run dev
```

Then visit [http://localhost:3000](http://localhost:3000)

---

## 📁 Folder Structure

Billet just wants you to separate your backend logic and view creation (HTML) from your frontend code (style and interactivity). You can do what you like in terms of dir structure but here is the high level:

```
├── public/           # Static assets (logo, etc)
├── src/
│   ├── client/       # Frontend (component and page CSS + JS)
│   ├── server/       # Server routes, SSR templates using JSX (views)
│   └── types/        # Shared TypeScript types
├── dist/             # Build output
├── package.json      # Project metadata & scripts
└── README.md         # This file
```

---

## 🤝 Contributing

Contributions are welcome! Please open issues or PRs. Use `bun commit` to trigger the [gitmoji](https://gitmoji.dev/) commit message builder.

---

## ☁️ Deploy

Deploy instantly on [Railway](https://railway.com?referralCode=XB1wns):

1. Push to GitHub
2. Create a new Railway project
3. Select your repo
4. Watch it fly!

---

## 📄 License

MIT — free for personal and commercial use.

---

<p align="center">
  <i>Made with ❤️ in Sheffield, UK</i>
</p>
