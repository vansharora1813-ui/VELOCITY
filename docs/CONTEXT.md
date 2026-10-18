# The Living Blueprint — Context & Architecture

## 1. Product Definition
**The Living Blueprint** is a developer tool designed to help engineers and tech leads understand what AI coding agents have actually built, what remains incomplete, and what the evidence proves.

Instead of parsing opaque chat histories or trusting unverified completion claims, developers view their codebase through an interactive, visual software-architecture house where components and rooms reflect real architectural domains, backed by verified tests, git commits, and code artifacts.

## 2. Fixed Design & Product Decisions
- **Main Visual Canvas**: An interactive, explorable isometric software-architecture house representing domains, layers, and status.
- **Persistent Chat Panel**: Sits on the desktop right-hand side, with its companion avatars and title header centered at the top.
- **AI Companions (Barkley & Cleo)**:
  - **Dog (Barkley)**: Friendly, energetic, helpful, focusing on forward momentum, scaffolding, and orientation. Speaks first in casual, conversational language.
  - **Cat (Cleo)**: Sassy, observant, skeptical, demanding proof, checking test coverage, and flagging brittle assumptions. Joins selectively when there are real risks or gaps.
  - *Unified AI Architecture*: One model call per turn produces structured JSON containing 1 or 2 messages (`speaker: 'dog' | 'cat'`). The model decides when the cat speaks.
  - *Pixel Pet Rendering*: Compact vector pixel art adapted from procedural raster techniques inspired by [pixel-pet](https://github.com/blendi-remade/pixel-pet) (MIT License), rendered in the coffee/slate palette with subtle idle animations, without loading external browser extensions.
- **Real Repository Scanning**: The production application ingests and scans real GitHub repositories using bounded REST API calls. Pre-canned datasets (e.g. BookNook) exist strictly as fallback demonstrations and are explicitly labeled as sample data.
- **Truthful Status Policy**: Never claim a repository was scanned, a test passed, a build succeeded, or an AI responded unless it has actually occurred and produced verifiable output.

## 3. Core Evidence & Status Principle
Code existing is not proof that a requirement works. The Living Blueprint categorizes rooms/subsystems into unambiguous, evidence-backed states:
- **Verified**: Passing automated tests, verified builds, or validated runtime evidence.
- **Implemented**: Source code or configuration exists, but automated verification is missing or incomplete.
- **Planned**: Defined in scope/architecture but missing implementation.
- **Blocked**: Failing test suites, broken dependencies, or active blockers.
- **Unknown**: Insufficient or contradictory evidence.

### Observed Evidence vs. AI Companion Interpretation
There is a strict architectural firewall between deterministic evidence and AI dialogue:
1. **Observed Evidence (Ground Truth)**: Sourced from verified git trees, manifests, source code, and test runner outputs. Processed exclusively by the deterministic `statusEngine.ts`.
2. **AI Companion Interpretation**: The AI companions can explain, critique, and guide the user through the codebase, but the AI model **cannot mutate or set room status directly**. Even if an AI asserts a feature is verified, the engine ignores AI claims for verified status without passing test evidence.
3. **Security Boundary**: Scanned repository files and READMEs are treated as untrusted data. The model is explicitly instructed to disregard prompt injections or instructions embedded in scanned code.

## 4. Production & Server Architecture (Vercel Serverless + Vite)
All API keys and LLM requests remain strictly server-side and are never exposed to Vite or client bundles.
- **Provider**: Google Gemini REST API (`https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`).
- **Unified Handlers**: Business logic and security boundaries are implemented once in `src/server/` (`chatHandler.ts`, `investigateHandler.ts`, `healthHandler.ts`) and shared between local Vite middleware (`vitePluginAiChat.ts`) and Vercel serverless functions (`api/chat.ts`, `api/investigate.ts`, `api/health.ts`).
- **Production Serverless Routes (`api/`)**:
  - `POST /api/chat`: AI companion group chat with Barkley & Cleo.
  - `POST /api/investigate`: Evidence-backed room investigation & prompt generation.
  - `GET /api/health`: Non-sensitive service status and config check (`aiConfigured: true/false`).
- **Environment Variables**:
  - `GEMINI_API_KEY`: Secret API key obtained from Google AI Studio. Set in Vercel Project Settings > Environment Variables.
  - `AI_MODEL`: Optional model name (default: `gemini-3.8-flash`).
- **Deployment Configuration (`vercel.json`)**:
  - Build Command: `npm run build` (`tsc && vite build`)
  - Output Directory: `dist`
  - Clean URLs: `true`
  - SPA Rewrites: Routes `/api/*` to serverless endpoints and all other routes to `/index.html`.
- **Post-Deploy Smoke Testing**:
  - Test health: `curl -s https://<project>.vercel.app/api/health`
  - Verify same-origin chat & investigation directly from deployed website interface.
  - If `GEMINI_API_KEY` is omitted, endpoints respond cleanly with `CONFIG_REQUIRED` without fabricating responses.

## 5. Phased Roadmap
- **Milestone T01 (Complete)**: Running Foundation + Visible House Shell. Minimum scaffold, isometric SVG house with foundation, pillars, rooms, roof, restrained dark coffee theme, preview chat panel with companion identities, and sample data status labeling.
- **Milestone T02 (Complete)**: Evidence-Backed Project Status Engine. Typed domain models, deterministic 5-status derivation engine, requirement-level relevance, evidence history supersession, and 100% pure TypeScript unit tests.
- **Milestone T03 (Complete)**: Real GitHub Repository Ingestion. Public repo URL validation, bounded Git tree scanning (up to 12 files), file filtering/prioritization, rate-limit parsing, telemetry drawer, and dynamic house mapping.
- **Milestone T04 (Complete)**: AI Group Chat + Dog & Cat Companions. Shared model call with multi-persona JSON replies, grounded repo context, secure server-side integration (`/api/chat`), pixel pet avatars, typing indicator, and untrusted repo data defense.
- **Milestone T05 (Complete)**: Evidence-Backed Investigation & Repair Prompt Generation. Room-level investigation workflow (`POST /api/investigate`), structured finding schema (`IssueCategory`, `IssueSeverity`, `EvidenceClassification`), strict evidence validation against scanned files (fabricated path filtering, uninspected file marking, severity capping), copy-ready self-contained coding agent repair prompts (with acceptance criteria and investigation-first mode for weak evidence), and visual copy confirmation, maintaining the deterministic status engine boundary.
- **Milestone T06 (Complete)**: Fix Reporting, Repository Re-Inspection and Evidence-Based Verification. Read-only lifecycle completing repair workflow (`UserFixReport`, `reinspectForFix`), commit SHA/PR reference validation against active repository identity, commit change inspection and diff budget tracking, automated GitHub CI check run classification and functional test relevance evaluation, strict evidence provenance (`source_code` for inspected changes, `test_result` for real CI outcomes, `user_confirmation` for pasted text claims), deterministic status updates and failure supersession, and UI lifecycle card with companion dialogue and refresh actions.
- **Milestone T07 (Current - Complete)**: Production API Deployment and End-to-End Readiness. Vercel-compatible root `api/` serverless functions (`api/chat.ts`, `api/investigate.ts`, `api/health.ts`), unified request parsing for both stream and pre-parsed bodies, payload size and Content-Type validation, zero-leak credential protection, Vercel SPA deployment configuration (`vercel.json`), and comprehensive route tests.
