import { describe, expect, it } from "vitest";
import {
  renderTemplate,
  syncTemplates,
  TEMPLATE_DEFINITIONS,
  templateCreatePayload,
  templateDefinition,
  templateProblems,
  type TemplateManager,
} from "../src";

describe("template definitions", () => {
  it("all follow Meta's rules", () => {
    for (const t of TEMPLATE_DEFINITIONS) expect(templateProblems(t), t.name).toEqual([]);
  });

  it("catches a body that starts or ends with a variable", () => {
    const bad = { ...templateDefinition("ask_lead_outcome")!, body: "{{1}} respondeu {{2}}", examples: ["a", "b"] };
    expect(templateProblems(bad)).toEqual(["body starts with a variable", "body ends with a variable"]);
  });

  it("builds the Graph payload with examples and quick replies", () => {
    expect(templateCreatePayload(templateDefinition("ask_lead_outcome")!)).toEqual({
      name: "ask_lead_outcome",
      language: "pt_BR",
      category: "MARKETING",
      components: [
        { type: "BODY", text: "Como ficou o atendimento de {{1}}? Toque em uma das opções abaixo para registrar o resultado.", example: { body_text: [["Maria"]] } },
        {
          type: "BUTTONS",
          buttons: [
            { type: "QUICK_REPLY", text: "Ganhou" },
            { type: "QUICK_REPLY", text: "Perdeu" },
            { type: "QUICK_REPLY", text: "Segue negociando" },
          ],
        },
      ],
    });
  });

  it("renders the same text the template would show", () => {
    expect(renderTemplate(templateDefinition("notify_owner_reminder")!, ["Ana", "5"])).toBe(
      "O lead Ana está esperando resposta há 5 minutos. Abra o WhatsApp Business para responder.",
    );
  });
});

describe("syncTemplates", () => {
  it("creates only what the account is missing, for the asked audiences", async () => {
    const created: string[] = [];
    const manager: TemplateManager = {
      list: async () => [{ name: "notify_new_lead", language: "pt_BR", status: "PENDING" }],
      create: async (_waba, t) => {
        if (t.name === "weekly_report") throw new Error("Invalid parameter");
        created.push(t.name);
        return { id: "1", status: "PENDING" };
      },
    };

    const results = await syncTemplates(manager, "waba", ["team"]);
    expect(created).not.toContain("notify_new_lead");
    expect(created).not.toContain("follow_up_1");
    expect(results.find((r) => r.name === "notify_new_lead")).toEqual({ name: "notify_new_lead", result: "exists", status: "PENDING" });
    expect(results.find((r) => r.name === "weekly_report")).toMatchObject({ result: "failed", error: "Invalid parameter" });
    expect(results.filter((r) => r.result === "created")).toHaveLength(5);
  });
});
