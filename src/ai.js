import { CONFIG } from "./config.js";
import { Log } from "./logger.js";

export const ai = {
  buildPrompt(snapshot) {
    const tabCount = snapshot.length;
    const lastIndex = tabCount - 1;
    const maxGroups = Math.min(
      CONFIG.grouping.maxGroups,
      Math.max(
        CONFIG.grouping.minGroups,
        Math.ceil(tabCount / CONFIG.grouping.targetTabsPerGroup),
      ),
    );
    const hasGroups = snapshot.some((tab) => tab.group);
    const stability = hasGroups
      ? `
- STABILITY: many tabs already have a "group" name. When a tab's current
group still makes sense, KEEP it there and reuse that exact name — do not
rename or reshuffle a sensible group just to change it. Prefer adding new
tabs into a fitting existing group over inventing a parallel one.
- REORGANIZE only with a clear reason: e.g. new tabs make a BROADER category
sensible (an existing "Cooking" group plus new chicken-care tabs becomes
"Chicken"), or the current split is clearly wrong. A broader, more accurate
category is worth moving older tabs for; cosmetic churn is not.`
      : "";
    return `You are "Tidy", an engine that organizes a browser sidebar's open tabs
into a small set of clean, intuitive groups — like Arc's "Tidy Tabs".

## Input
${tabCount} tabs. Each object has {"i": <index 0-${lastIndex}>, "title": <string>}
and may also include "url": <string> and "group": <string> (the name of
the group the tab is CURRENTLY in). Treat "group" as a strong hint, not a
command. Use whatever fields are present; the title is always the primary signal.

The ${tabCount} tabs are provided in the user message as a JSON array,
one object per tab.

## What a good grouping looks like
- Group by what the user is DOING — a project, topic, game, or task —
not merely by website. Tabs from different domains often belong
together (a wiki page, a YouTube video, and a store page about the
same game are one group).
- Name an EXPANDABLE CATEGORY, not the single tab in front of you. A
group should be something later tabs could naturally join: "Wynncraft"
over "Gaming", "Chicken Recipes" over "Grandma's Chicken Soup". Don't
make a group as specific as possible — as specific as is still reusable.
- Prefer multi-tab groups. A single-tab group is fine ONLY when its name
is a real category a later tab could join, never when it just
re-describes that one tab.
- Keep granularity consistent: groups of roughly comparable size.
Avoid one giant catch-all sitting next to several singletons.
- Merge near-duplicates (the same product, repeated searches) together.${stability}

## Grounding (critical)
- Use ONLY the titles and URLs given. Never invent a theme that the
tabs do not clearly support. If no tab is about sports, there is no
"Sports" group. Every group must be justified by its members.

## Avoid
- A vague mega-group holding most tabs.
- Many one-tab groups when those tabs share an obvious theme.
- A one-tab group whose name just describes that tab (a recipe group
named after one dish) instead of an expandable category.
- Two different groups that mean the same thing.

## Naming
- 1-3 words, Title Case, human-readable. No emojis, no quotes.
- Name the shared theme, not a list of the items.
- "Other" is a LAST RESORT — only for a tab that fits no reasonable
category, or a pile of mutually unrelated tabs. Never reach for it when
a genuine expandable category fits. Avoid "Misc", "Various", "General",
"Web", and "Stuff" entirely; use "Other" if you truly must.

## Hard constraints (must all hold)
1. Produce between 1 and ${maxGroups} groups (1 is fine if every tab shares one theme).
2. Every index 0-${lastIndex} appears in EXACTLY ONE group.
 Never skip an index, never repeat one, never invent one out of range.
3. Output ONLY a single JSON object matching the schema — no prose,
 no markdown, no code fences.

## Output schema
{"groups":[{"name":"<Title Case label>","tabs":[<indices>]}]}

## Examples
Input: [{"i":0,"title":"Horses - Wynncraft Wiki","url":"wiki.wynncraft.com/horses"},{"i":1,"title":"Wynncraft Market","url":"trade.wynncraft.com"},{"i":2,"title":"Best Beef Chili Recipe","url":"allrecipes.com/chili"},{"i":3,"title":"Van Gogh Mouse Pad - AliExpress","url":"aliexpress.com/x"},{"i":4,"title":"Monet Mouse Pad - AliExpress","url":"aliexpress.com/y"}]
Output: {"groups":[{"name":"Wynncraft","tabs":[0,1]},{"name":"Mouse Pad Shopping","tabs":[3,4]},{"name":"Recipes","tabs":[2]}]}

Input (all one theme): [{"i":0,"title":"React useEffect docs","url":"react.dev"},{"i":1,"title":"React Router tutorial","url":"reactrouter.com"},{"i":2,"title":"Why my React app re-renders","url":"stackoverflow.com"}]
Output: {"groups":[{"name":"React","tabs":[0,1,2]}]}

Input (one solid theme + unrelated odds and ends): [{"i":0,"title":"Rust ownership - The Rust Book"},{"i":1,"title":"Tokio async tutorial"},{"i":2,"title":"Why won't my future compile - stackoverflow"},{"i":3,"title":"DMV appointment booking"},{"i":4,"title":"Local weather - today"}]
Output: {"groups":[{"name":"Rust","tabs":[0,1,2]},{"name":"Other","tabs":[3,4]}]}

Now output only the JSON object.`;
  },

  buildUserContent(snapshot) {
    return `<tabs>\n${JSON.stringify(snapshot)}\n</tabs>`;
  },

  responseSchema() {
    return {
      type: "object",
      additionalProperties: false,
      required: ["groups"],
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "tabs"],
            properties: {
              name: { type: "string" },
              tabs: { type: "array", items: { type: "integer" } },
            },
          },
        },
      },
    };
  },

  async request(snapshot, apiKey, model) {
    const maxTokens = Math.min(
      CONFIG.api.maxTokensCeiling,
      Math.max(
        CONFIG.api.maxTokens,
        snapshot.length * CONFIG.api.tokensPerTab + CONFIG.api.tokensBuffer,
      ),
    );
    const base = {
      model,
      temperature: CONFIG.api.temperature,
      seed: CONFIG.api.seed,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: ai.buildPrompt(snapshot) },
        { role: "user", content: ai.buildUserContent(snapshot) },
      ],
    };

    const formats = [
      {
        type: "json_schema",
        json_schema: {
          name: "tidy_groups",
          strict: true,
          schema: ai.responseSchema(),
        },
      },
      { type: "json_object" },
      null,
    ];
    let lastError;
    for (let i = 0; i < formats.length; i++) {
      const body = formats[i]
        ? { ...base, response_format: formats[i] }
        : { ...base };
      try {
        return await ai.post(body, apiKey);
      } catch (e) {
        const rejectsFormat =
          e?.status === 400 &&
          /response_format|json[_ ]?schema|json/i.test(e.message ?? "");
        if (rejectsFormat && i < formats.length - 1) {
          const next = formats[i + 1];
          Log.ai.warn(
            `Model "${model}" rejected response_format=${formats[i].type} (HTTP 400); retrying with ${next ? next.type : "no response_format"}.`,
          );
          lastError = e;
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  },

  async post(body, apiKey) {
    Log.ai.debug(
      `Requesting completion from OpenRouter (model: ${body.model}, max_tokens: ${body.max_tokens}, timeout: ${CONFIG.api.timeoutMs}ms).`,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.api.timeoutMs);

    let response;
    try {
      response = await fetch(CONFIG.api.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": CONFIG.api.referer,
          "X-Title": CONFIG.api.title,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        Log.ai.error(
          `OpenRouter request aborted after exceeding the ${CONFIG.api.timeoutMs / 1000}s timeout (model: ${body.model}).`,
        );
        throw new Error(
          `OpenRouter request timed out after ${CONFIG.api.timeoutMs / 1000}s`,
        );
      }
      Log.ai.error(
        `Network error while contacting OpenRouter (endpoint: ${CONFIG.api.endpoint}).`,
        e,
      );
      throw e;
    } finally {
      clearTimeout(timer);
    }

    Log.ai.debug(
      `OpenRouter responded with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}.`,
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(
        0,
        CONFIG.api.errorBodyMaxChars,
      );
      Log.ai.error(
        `OpenRouter request failed with HTTP ${response.status}. Response body (truncated): ${detail}`,
      );
      const error = new Error(`OpenRouter ${response.status}: ${detail}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  },

  extractText(data) {
    if (data.error) {
      const detail = data.error.message || JSON.stringify(data.error);
      Log.ai.error("OpenRouter returned an error payload:", detail);
      throw new Error(`API error: ${detail}`);
    }

    if (data.choices?.[0]?.finish_reason === "length") {
      Log.ai.error(
        "Model response was truncated (finish_reason: length).",
        "model:",
        data.model,
        "| usage:",
        JSON.stringify(data.usage),
      );
      throw new Error(
        "Model response was truncated before completing the JSON (hit the " +
          "output token limit). Try tidying fewer tabs or use a model with a " +
          "larger output budget.",
      );
    }

    const message = data.choices?.[0]?.message;
    const rawContent = Array.isArray(message?.content)
      ? message.content
          .map((part) => part?.text ?? part?.content ?? "")
          .join("")
      : (message?.content ?? "");
    const content = rawContent.trim();
    if (!content && message?.reasoning) {
      Log.ai.debug(
        "Model returned reasoning but no completion; treating as empty.",
        String(message.reasoning).slice(0, CONFIG.api.outputPreviewMaxChars),
      );
    }

    if (!content) {
      Log.ai.error(
        "Model returned an empty completion.",
        "finish_reason:",
        data.choices?.[0]?.finish_reason,
        "| model:",
        data.model,
        "| usage:",
        JSON.stringify(data.usage),
      );
      throw new Error(
        "Model returned empty content. Try a concrete instruct model " +
          "(e.g. openai/gpt-4o-mini) instead of a free/reasoning router.",
      );
    }
    return content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  },

  parseGroups(text, sourceTabs) {
    const preview = () => text.slice(0, CONFIG.api.outputPreviewMaxChars);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      Log.ai.debug(
        "Completion was not strict JSON; extracting the first {…} block.",
      );
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) {
        Log.ai.error(
          "Could not extract any JSON object from the model output (truncated):",
          preview(),
        );
        throw new Error(`Could not parse model output: ${preview()}`);
      }
      parsed = JSON.parse(match[0]);
    }

    const groupList = Array.isArray(parsed?.groups) ? parsed.groups : [];
    const used = new Set();
    const result = groupList.reduce((acc, group) => {
      const members = (Array.isArray(group?.tabs) ? group.tabs : [])
        .map((raw) => (typeof raw === "string" ? Number(raw) : raw))
        .filter(
          (index) =>
            typeof index === "number" &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < sourceTabs.length &&
            !used.has(index),
        )
        .map((index) => {
          used.add(index);
          return sourceTabs[index];
        });

      if (members.length > 0) {
        acc.push({
          name: String(group?.name ?? "").trim() || "Group",
          tabs: members,
        });
      }
      return acc;
    }, []);

    const singletonBudget = result.filter((g) => g.tabs.length >= 2).length;
    let singletonsKept = 0;
    const { kept, overflow } = result.reduce(
      (acc, group) => {
        if (group.tabs.length >= 2) {
          acc.kept.push(group);
        } else if (singletonsKept < singletonBudget) {
          acc.kept.push(group);
          singletonsKept++;
        } else {
          acc.overflow.push(...group.tabs);
        }
        return acc;
      },
      { kept: [], overflow: [] },
    );
    if (overflow.length > 0) {
      Log.ai.debug(
        `Single-tab budget exceeded; folding ${overflow.length} surplus singleton tab(s) into "Other".`,
      );
    }

    const ungrouped = sourceTabs.filter((_, i) => !used.has(i));
    if (ungrouped.length > 0) {
      Log.ai.debug(
        `Model left ${ungrouped.length} tab(s) ungrouped; collecting them into "Other".`,
      );
    }
    const other = [...overflow, ...ungrouped];
    if (other.length > 0) {
      kept.push({ name: "Other", tabs: other });
    }
    Log.ai.debug(
      `Parsed model output into ${kept.length} group(s) covering ${used.size + ungrouped.length} tab(s).`,
    );
    return kept;
  },
};
