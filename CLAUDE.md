# Claude guidance

Follow `AGENTS.md`, especially the rendering, export, PWA, testing, and release invariants.

## Pull request review policy

Evaluate every review comment on its merits:

- Apply real bugs or improvements.
- Decline requests that weaken a documented invariant, and record why.
- Refute incorrect claims with primary documentation, tests, CI results, or concrete code evidence.
- Never apply a change merely to satisfy an automated reviewer.
- Do not revisit an already resolved point without genuinely new evidence.
- Keep a running record of declined findings so later rounds do not flip-flop.

Automated review is advisory. Human comments must always be addressed. Do not merge a pull request
unless the user explicitly requests it or repository policy clearly authorizes it.
