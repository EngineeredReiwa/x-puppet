# I keep making LLM agents rediscover the same DOM selectors. Trying to package that as reusable recipes — does this make sense?

Cross-posting a thought I've been chewing on (HN thread: https://news.ycombinator.com/ — will edit with link once it settles).

When you hand a browser task to an LLM agent — MCP browser tools, Puppeteer + vision, Chrome DevTools MCP, whatever — the agent re-derives the same workflow every single run. Same selectors, same waits, same UI flow, same failure modes. Even when the site hasn't changed in weeks.

That's wasteful, but not the *interesting* problem.

The interesting problem is **silent failure**.

On modern React-style UIs, a lot of naive DOM operations *look* like they succeeded when you read the DOM back, but the app's internal state never updated. Examples I hit this week:

- `textarea.value = "X"` on a React-controlled input: DOM reads `"X"`, but the component's state is still empty. On next render, it's gone.
- `editor.innerHTML = "<h2>...</h2>"` on a ProseMirror editor: DOM reads the HTML, but ProseMirror's internal doc model never accepted it. Next keystroke wipes it.
- Clicking a "publish" button via `element.click()`: button fires onClick handler, but React's synthetic event system sees `isTrusted: false` and ignores it. The button *looks* clicked.

A recipe-less LLM agent running these naive approaches reports "done" and moves on. That's worse than slow — it's wrong without knowing.

What I'm trying instead: package site-specific workflow knowledge (which selectors actually work, which waits are required, which naive ops silently fail, how to verify for real) into reusable recipes that the agent calls as a single tool. One function call, one verified result, no DOM rediscovery.

I built a tiny OSS prototype called **pupplet** with recipes for X/Twitter, Reddit, Discord, and note.com. CDP-first for now, but I don't think CDP is the important part — the point is the *recipe format*, not the backend.

I did run some measurements (2 tasks × 2 conditions × 3 trials each) and the recipe version used about 17–18× fewer tool calls and 7–8× less context than a step-by-step discovery loop. But honestly, the tool-call count isn't the part I care about most. In the 1M-context era, raw token savings is a weak argument. The *correctness* argument — not silently failing — feels more load-bearing.

GitHub: https://github.com/EngineeredReiwa/pupplet
Measurement report: https://github.com/EngineeredReiwa/pupplet/blob/main/experiments/REPORT.md

What I'd love feedback on, especially from this sub:

1. Has anyone here tried running browser agents with a local model (Llama 3.3, Qwen, etc.)? Does the silent-failure problem get worse or better when the model is smaller / has shorter context?
2. Does "site-specific recipe catalog" feel like a real OSS category to you, or is it just a private utility each team should build for themselves?
3. What sites have you hit silent-failure footguns on that I should add?

Recipes are brittle by definition — when a site redesigns, the recipe breaks. The bet is that community maintenance + clear failure modes is cheaper than every agent rediscovering the same broken selectors every hour. I'm not sure that bet pays off yet. That's part of what I'm trying to learn.

---

*Meta: this post was submitted to Reddit using pupplet itself. I had to add the `submit` command before posting — the commit is in the repo history. Small joke, but it's also how I'd catch regressions fastest.*
