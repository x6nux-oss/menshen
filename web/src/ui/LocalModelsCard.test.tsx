// 本地模型卡：状态展示、下载请求、提交中禁用与失败提示。
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockLocalModels } from "../mocks/fixtures";
import { renderPage } from "../test/renderPage";
import { server, startTestServer } from "../test/server";
import { LocalModelsCard } from "./LocalModelsCard";

startTestServer();

describe("LocalModelsCard", () => {
  it("展示两个模型、大小与 NSFW 阈值", async () => {
    renderPage(<LocalModelsCard />);

    expect(await screen.findByText("PP-OCRv6 small")).toBeInTheDocument();
    expect(screen.getByText("Marqo NSFW")).toBeInTheDocument();
    expect(screen.getByLabelText("NSFW 阈值（%）")).toHaveValue("85");
  });

  it("一键下载只发送 download，提交中禁用重复点击", async () => {
    const bodies: Record<string, unknown>[] = [];
    let release: (() => void) | undefined;
    server.use(
      http.post("*/miniapp/api/localmodels", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "status") return HttpResponse.json(mockLocalModels);
        bodies.push(body);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return HttpResponse.json({ ok: true });
      }),
    );

    renderPage(<LocalModelsCard />);
    const button = await screen.findByRole("button", {
      name: "一键下载并启用",
    });
    fireEvent.click(button);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ action: "download" });
    expect(button).toBeDisabled();

    release?.();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("下载失败显示服务端错误，可再次重试", async () => {
    server.use(
      http.post("*/miniapp/api/localmodels", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "status") return HttpResponse.json(mockLocalModels);
        return HttpResponse.json(
          { error: "下载失败，请重试" },
          { status: 500 },
        );
      }),
    );

    renderPage(<LocalModelsCard />);
    fireEvent.click(
      await screen.findByRole("button", { name: "一键下载并启用" }),
    );

    expect(await screen.findByText("下载失败，请重试")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "一键下载并启用" }),
      ).not.toBeDisabled(),
    );
  });
});
