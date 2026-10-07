// features/alliance/logs 单测（阶段4 自 helpers.test.ts 迁移）

import { describe, it, expect } from "vitest";
import { normalizeAllianceLogSection } from "./logs";

describe('normalizeAllianceLogSection', () => {
  it('returns explicit section values directly', () => {
    expect(normalizeAllianceLogSection({ section: "personnel", category: "", text: "" })).toBe("personnel");
    expect(normalizeAllianceLogSection({ section: "siege", category: "", text: "" })).toBe("siege");
    expect(normalizeAllianceLogSection({ section: "management", category: "", text: "" })).toBe("management");
    expect(normalizeAllianceLogSection({ section: "city", category: "", text: "" })).toBe("city");
    expect(normalizeAllianceLogSection({ section: "profession", category: "", text: "" })).toBe("profession");
  });

  it('infers section from category prefix', () => {
    expect(normalizeAllianceLogSection({ section: null, category: "personnel:1001336", text: "" })).toBe("personnel");
    expect(normalizeAllianceLogSection({ section: null, category: "profession:123", text: "" })).toBe("profession");
  });

  it('maps mail category codes to siege', () => {
    expect(normalizeAllianceLogSection({ section: null, category: "mail:1000007", text: "" })).toBe("siege");
    expect(normalizeAllianceLogSection({ section: null, category: "mail:1000010", text: "" })).toBe("siege");
  });

  it('infers section from text content', () => {
    expect(normalizeAllianceLogSection({ section: null, category: "", text: "玩家张三加入了同盟" })).toBe("personnel");
    expect(normalizeAllianceLogSection({ section: null, category: "", text: "向敌方同盟宣战" })).toBe("siege");
    expect(normalizeAllianceLogSection({ section: null, category: "", text: "最后一击攻城" })).toBe("siege");
    expect(normalizeAllianceLogSection({ section: null, category: "", text: "军屯耕作完毕" })).toBe("profession");
    expect(normalizeAllianceLogSection({ section: null, category: "", text: "迁城至新坐标" })).toBe("city");
  });

  it('defaults to management for unrecognized input', () => {
    expect(normalizeAllianceLogSection({ section: null, category: "other:999", text: "普通消息" })).toBe("management");
    expect(normalizeAllianceLogSection({ section: "unknown", category: "", text: "" })).toBe("management");
  });
});
