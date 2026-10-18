# The Living Blueprint — Context & Architecture

## 1. Product Definition
**The Living Blueprint** is a developer tool designed to help engineers and tech leads understand what AI coding agents have actually built, what remains incomplete, and what the evidence proves.

Instead of parsing opaque chat histories or trusting unverified completion claims, developers view their codebase through an interactive, visual software-architecture house where components and rooms reflect real architectural domains, backed by verified tests, git commits, and code artifacts.

## 2. Fixed Design & Product Decisions
- **Main Visual Canvas**: An interactive, explorable isometric software-architecture house representing domains, layers, and status.
- **Persistent Chat Panel**: Sits on the desktop right-hand side, with its title header centered at the top of that panel.
- **AI Companions**:
  - **Dog (Barkley)**: Friendly, energetic, helpful, focusing on forward momentum, scaffolding, and positive reinforcement.
  - **Cat (Cleo)**: Sassy, observant, skeptical, demanding proof, checking test coverage, and flagging brittle assumptions.
  - *Future implementation*: Both personas will be driven by a unified AI model guided by distinct persona rules, rather than static templates.
  - *Rendering reference*: Architectural inspiration will adapt the rendering approach of [pixel-pet](https://github.com/blendi-remade/pixel-pet) following license inspection, without embedding extensions or blindly copying assets.
- **Real Repository Scanning**: The production application ingests and scans real GitHub repositories. Pre-canned datasets (e.g. BookNook) exist strictly as fallback demonstrations and must be explicitly labeled as sample data.
- **Truthful Status Policy**: Never claim a repository was scanned, a test passed, a build succeeded, or an AI responded unless it has actually occurred and produced verifiable output.

## 3. Core Evidence & Status Principle
Code existing is not proof that a requirement works. The Living Blueprint categorizes rooms/subsystems into unambiguous, evidence-backed states:
- **Verified**: Passing automated tests, verified builds, or validated runtime evidence.
- **In Progress / Under Construction**: Actively being modified or implemented.
- **Planned / Wireframe**: Defined in scope/architecture but missing implementation.
- **Failing / Blocked**: Failing test suites, broken dependencies, or blocked prerequisites.
- **Unknown**: Present in codebase but unverified or missing telemetry.

## 4. Phased Roadmap
- **Milestone T01 (Current)**: Running Foundation + Visible House Shell. Minimum scaffold, isometric SVG house with foundation, pillars, rooms, roof, restrained dark coffee theme, preview chat panel with companion identities, and sample data status labeling.
- **Milestone T02**: GitHub Repository Ingestion & Evidence Scanner. Connecting real repo AST, git history, and test runner outputs to drive room status.
- **Milestone T03**: Interactive Room Inspection & Deep Dive. Detailed drawer/modal viewing evidence files, commit history, and test logs per subsystem.
- **Milestone T04**: AI Companions Live Integration. Unified model backend powering live multi-persona dialogue (Barkley & Cleo) responding to codebase status and evidence queries.
- **Milestone T05**: Continuous Agent Sync & Export. Real-time updates as external coding agents commit changes, plus summary export.
