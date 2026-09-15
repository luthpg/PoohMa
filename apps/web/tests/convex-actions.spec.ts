import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailReq } from "../convex/actions";

const sendMock = vi.fn();

vi.mock("resend", () => {
  return {
    Resend: class {
      emails = {
        send: sendMock,
      };
    },
  };
});

describe("convex/actions: sendEmailReq", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("DISABLE_EMAIL_DELIVERY=true の場合、Resend APIを呼び出さずに true を返すこと（メール送信スキップ）", async () => {
    process.env.DISABLE_EMAIL_DELIVERY = "true";
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_MAIL_FROM;

    const result = await sendEmailReq({
      email: "test@example.com",
      subject: "テスト件名",
      html: "<p>テスト本文</p>",
      text: "テスト本文",
    });

    expect(result).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("DISABLE_EMAIL_DELIVERY=false の場合、通常通り Resend API が呼び出されること", async () => {
    process.env.DISABLE_EMAIL_DELIVERY = "false";
    process.env.RESEND_API_KEY = "test_resend_api_key";
    process.env.RESEND_MAIL_FROM = "noreply@example.com";
    sendMock.mockResolvedValue({ data: { id: "msg_123" }, error: null });

    const result = await sendEmailReq({
      email: "test@example.com",
      subject: "テスト件名",
      html: "<p>テスト本文</p>",
      text: "テスト本文",
      replyTo: "support@example.com",
    });

    expect(result).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: "PoohMa <noreply@example.com>",
      to: ["test@example.com"],
      subject: "テスト件名",
      html: "<p>テスト本文</p>",
      text: "テスト本文",
      replyTo: "support@example.com",
    });
  });

  it("DISABLE_EMAIL_DELIVERY が未設定の場合、通常通り Resend API が呼び出されること", async () => {
    delete process.env.DISABLE_EMAIL_DELIVERY;
    process.env.RESEND_API_KEY = "test_resend_api_key";
    process.env.RESEND_MAIL_FROM = "noreply@example.com";
    sendMock.mockResolvedValue({ data: { id: "msg_456" }, error: null });

    const result = await sendEmailReq({
      email: "user1@example.com, user2@example.com",
      subject: "複数送信テスト",
      html: "<p>テスト</p>",
      text: "テスト",
    });

    expect(result).toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({
      from: "PoohMa <noreply@example.com>",
      to: ["user1@example.com", "user2@example.com"],
      subject: "複数送信テスト",
      html: "<p>テスト</p>",
      text: "テスト",
      replyTo: undefined,
    });
  });

  it("Resend API がエラーを返した場合、sendEmailReq が false を返すこと", async () => {
    process.env.DISABLE_EMAIL_DELIVERY = "false";
    process.env.RESEND_API_KEY = "test_resend_api_key";
    process.env.RESEND_MAIL_FROM = "noreply@example.com";
    sendMock.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded" },
    });

    const result = await sendEmailReq({
      email: "test@example.com",
      subject: "テスト件名",
      html: "<p>テスト</p>",
      text: "テスト",
    });

    expect(result).toBe(false);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});
