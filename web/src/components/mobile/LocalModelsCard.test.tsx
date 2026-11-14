// 本地模型卡：状态展示、下载请求、提交中禁用与失败提示。
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { mockLocalModels } from "../../mocks/fixtures";
import { makeTestClient, renderPage } from "../../test/renderPage";
import { server, startTestServer } from "../../test/server";
import { ToastProvider } from "../feedback";
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

  it("桌面 /admin 路径：下载与配置仍发到 /admin/api", async () => {
    window.history.replaceState(null, "", "/admin/models");
    const bodies: Record<string, unknown>[] = [];
    const urls: string[] = [];
    server.use(
      http.post("*/admin/api/localmodels", async ({ request }) => {
        urls.push(request.url);
        const body = (await request.json()) as Record<string, unknown>;
        if (body.action === "status") {
          return HttpResponse.json({
            ...mockLocalModels,
            models: mockLocalModels.models.map((model) => ({
              ...model,
              ready: true,
            })),
          });
        }
        bodies.push(body);
        return HttpResponse.json({ ok: true });
      }),
    );

    render(
      <QueryClientProvider client={makeTestClient()}>
        <ToastProvider>
          <LocalModelsCard />
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "一键下载并启用" }),
    );
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(urls[0]).toMatch(/\/admin\/api\/localmodels$/);
    expect(bodies[0]).toEqual({ action: "download" });

    fireEvent.click(
      screen.getByRole("switch", { name: "启用 PP-OCRv6 small" }),
    );
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ action: "configure", model: "ocr", enabled: true });

    fireEvent.change(screen.getByLabelText("NSFW 阈值（%）"), {
      target: { value: "90" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存阈值" }));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toEqual({ action: "configure", threshold: 90 });
  });
});
