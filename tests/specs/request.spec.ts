import { expect, test } from "../src/fixtures";

// The shape of the model request and how the run handles imperfect replies:
//   TIDY-15 — deterministic sampling (temperature 0, best-effort seed).
//   TIDY-16 — schema-enforced Structured Outputs, degrading json_schema →
//             json_object → none when a provider rejects the stricter contract.
//   TIDY-17 — a truncated reply (finish_reason "length") or a reasoning-only
//             reply (empty content) fails clearly.
//   TIDY-18 — rubric in the system message, snapshot in the user message.
const PLAN = { groups: [{ name: "Anything", tabs: [0, 1, 2] }] };

async function runToModel(
  zen: import("../src/zen-driver").ZenDriver,
): Promise<void> {
  await zen.clickButton();
  await zen.driver.wait(
    async () => (await zen.fetchStubCallCount()) >= 1,
    15_000,
    "the model was never called",
    200,
  );
}

test.describe("Tidy model request", () => {
  test.beforeEach(async ({ zen }) => {
    await zen.reset();
    await zen.clearNotifications();
  });

  // TIDY-15: the request is sampled deterministically.
  test("sends deterministic sampling parameters", async ({ zen }) => {
    await zen.openTabs(4, "Sampling ");
    await zen.installFetchStub(PLAN);
    try {
      await runToModel(zen);
      const body = await zen.lastRequestJson();
      expect(
        body.temperature,
        "temperature is 0 for repeatable clustering",
      ).toBe(0);
      expect(
        typeof body.seed,
        "a fixed seed is sent as a best-effort hint",
      ).toBe("number");
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-16: the request asks for schema-enforced JSON.
  test("requests schema-enforced structured output", async ({ zen }) => {
    await zen.openTabs(4, "Schema ");
    await zen.installFetchStub(PLAN);
    try {
      await runToModel(zen);
      const body = await zen.lastRequestJson();
      expect(body.response_format?.type, "uses Structured Outputs").toBe(
        "json_schema",
      );
      expect(
        body.response_format?.json_schema?.strict,
        "the schema is strict",
      ).toBe(true);
      const schema = body.response_format?.json_schema?.schema as {
        properties?: { groups?: { type?: string } };
      };
      expect(
        schema?.properties?.groups?.type,
        "the schema constrains a groups array",
      ).toBe("array");
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-16: a provider that rejects json_schema still completes via a looser
  // contract, and the run succeeds.
  test("degrades to a looser output contract when the model rejects json_schema", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Degrade ");
    await zen.installFetchRejectThenSucceedStub(PLAN);
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /Sorted \d+ tabs into \d+ groups\./.test(note);
        },
        20_000,
        "the run never recovered after the json_schema rejection",
        200,
      );
      expect(
        await zen.fetchStubCallCount(),
        "the run retried after the rejection",
      ).toBe(2);
      const body = await zen.lastRequestJson();
      expect(
        body.response_format?.type,
        "the retry dropped to a looser contract",
      ).not.toBe("json_schema");
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-17: a reply cut off by the token limit fails with a clear message.
  test("fails clearly when the model response is truncated", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Truncated ");
    await zen.installFetchTruncatedStub();
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /truncat/i.test(note);
        },
        20_000,
        "no truncation-specific failure notification was shown",
        200,
      );
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-17: a reasoning-only reply (empty content) is rejected as an empty
  // completion; the reasoning prose is never parsed, even though it contains a
  // JSON block the tidier could have acted on.
  test("rejects a reasoning-only reply instead of parsing the reasoning prose", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Reasoning ");
    await zen.installFetchReasoningStub();
    try {
      await zen.clickButton();
      await zen.driver.wait(
        async () => {
          const note = await zen.lastNotification();
          return note != null && /empty content|instruct model/i.test(note);
        },
        20_000,
        "no empty-completion failure notification was shown",
        200,
      );
      expect(
        await zen.groupLabels(),
        "the reasoning's JSON block was never turned into a group",
      ).not.toContain("Draft");
    } finally {
      await zen.restoreFetch();
    }
  });

  // TIDY-18: instructions go in the system message, the snapshot in the user
  // message.
  test("puts the rubric in the system message and the snapshot in the user message", async ({
    zen,
  }) => {
    await zen.openTabs(4, "Placement ");
    await zen.installFetchStub(PLAN);
    try {
      await runToModel(zen);
      const body = await zen.lastRequestJson();
      const system = body.messages?.find((m) => m.role === "system");
      const user = body.messages?.find((m) => m.role === "user");
      expect(system, "a system message carries the instructions").toBeDefined();
      expect(user, "a user message carries the snapshot").toBeDefined();

      // The rubric lives in the system message, not the user message.
      expect(system?.content).toContain("EXPANDABLE CATEGORY");
      expect(user?.content ?? "").not.toContain("EXPANDABLE CATEGORY");

      // The <tabs> snapshot lives in the user message, not the system message.
      expect(user?.content).toContain("<tabs>");
      expect(system?.content ?? "").not.toContain("<tabs>");
    } finally {
      await zen.restoreFetch();
    }
  });
});
