# Project Overview
An enterprise TypeScript wrapper around CesiumJS. Goals:
- Enterprise developers (Angular) should use mapping without Cesium details.
- Strict TypeScript, tree-shakeable, test-driven.

# Workflow Rules
1. **Requirements first:** No coding or design until requirements are documented and approved.
2. **Architecture second:** Design modules/interfaces, then get approval.
3. **Implement third:** Write code and tests per approved plan.
4. **Demo with every feature:** Every new library feature or version ships with a
   matching update to `examples/demo-app` that exercises it **through the public
   API only** (never raw Cesium). A feature is not "done" until the demo
   demonstrates it, the demo builds against the freshly-built library, and the
   demo README documents it. The Implementation phase produces this; QA verifies
   it; the PM gates it (see the agent definitions in `.claude/agents/`).
5. **Review final:** QA and code review before merge.

# Coding Standards
- TypeScript strict mode, no `any`.
- Public APIs documented with JSDoc or TSDoc.
- Follow Angular style (for Angular implementation).
- High test coverage (≥90%).
- Use composition over inheritance.

# Preferences
User values maintainability, explicit architecture, security, and learning. 
Avoid hidden magic or unnecessary abstractions.
Always explain reasoning and trade-offs in comments.
