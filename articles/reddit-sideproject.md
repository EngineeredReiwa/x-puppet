# I built pupplet — site-specific browser recipes for LLM agents (so they stop rediscovering the same DOM selectors every run)

I've been building a small OSS tool called **pupplet** and wanted to share it here, because it started as a frustration-driven side project and turned into something I think might be useful to other people building LLM/agent workflows.

## The problem I kept hitting

Every time I handed a browser task to an LLM agent — whether via MCP browser tools, Puppeteer with vision, or Chrome DevTools MCP — the agent would re-derive the same workflow from scratch. Same selectors, same waits, same UI flows, same failure modes. Even when the target site hadn't changed in weeks.

That's wasteful, but honestly not the interesting problem.

The *interesting* problem is **silent failure**.

On modern React-style UIs, a lot of naive DOM operations look like they succeeded when you read the DOM back, but the app's internal state never updated. A few I hit recently:

- `textarea.value = "X"` on a React-controlled input: DOM reads "X", but the component's state is still empty. On next render, it's gone.
- `editor.innerHTML = "<h2>...</h2>"` on a ProseMirror editor: DOM reads the HTML, but ProseMirror's internal doc model never accepted it. Next keystroke wipes it.
- Clicking a publish button via `element.click()`: the onClick handler fires, but React's synthetic event system sees `isTrusted: false` and ignores it. The button *looks* clicked.

An LLM agent running these naive approaches reports "done" and moves on. That's worse than being slow — it's being wrong without knowing it.

## What I built

Pupplet is my attempt to package site-specific workflow knowledge (which selectors actually work, which waits are required, which naive ops silently fail, how to verify for real) into reusable recipes that the agent calls as a single tool. One function call, one verified result, no DOM rediscovery.

Current stack:
- Node.js, 1 dependency (`chrome-remote-interface`)
- Connects to your already-running Chrome via CDP — no new browser, no API keys, no login flows
- Platform modules for X/Twitter, Reddit, Discord, and note (the Japanese publishing platform), ~100 lines each
- Ships with a Claude Code skill so Claude can auto-discover the commands

The CDP backend isn't the important part to me — I don't think "which backend" is where the real insight is. The interesting bet is the *recipe format*: packaging fragile, site-specific workflow knowledge as short-lived but reusable code that agents can call without having to rediscover it every run.

## What I measured

I ran a small experiment (2 tasks × 2 conditions × 3 trials) comparing recipe calls against simulated low-level DOM discovery. The recipe version used about 17–18× fewer tool calls and 7–8× less context. But honestly, in the 1M-context era, raw token savings feels like a weak argument. The correctness argument — not silently failing on write tasks — feels more load-bearing to me.

Full measurement report is in the repo.

## What I'm not sure about

Recipes are brittle by definition. When a site redesigns, the recipe breaks. The whole thing rests on the bet that community maintenance + clear failure modes is cheaper than every agent rediscovering the same broken selectors every hour. I genuinely don't know yet if that bet pays off. That's part of what I want to find out.

## Feedback I'd love

- Does "site-specific recipe catalog for browser agents" feel like a real OSS category to you, or is this something each team should just build privately?
- Which sites would you want recipes for? I'm most likely to add what people actually hit silent-failure footguns on.
- If you've tried running browser agents against real sites, what broke for you that you wish someone had written down?

GitHub (with full measurement data in `experiments/`): https://github.com/EngineeredReiwa/pupplet

---

*Fun meta note: this post was submitted to Reddit using pupplet itself. I had to add `submit`, `edit`, and `deletePost` commands along the way — you can see them in the repo's commit history. The first attempt also got caught by a sibling sub's automod filter, which was itself a useful lesson about site-specific recipe brittleness.*
