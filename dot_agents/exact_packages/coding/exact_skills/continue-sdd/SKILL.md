---
name: continue-sdd
description: Continues sub-agent driven development for a given spec / plan.
---

Continue the work via sub-agent driven development for the given spec and plan
that'll be provided by the user. Ask for the spec / plan if the user didn't
provide any when invoking this skill.

Check the existing branches and ensure you're checking out the appropriate one.
If no branch other than `main` exists, then assume that work started on `main`
and continue working from there.

View the commit logs to gather more information on where the work was left off.

View the current working changes as well. If the working changes seem related to
the work, then continue it. Otherwise ask the user for more guidance.

$@
