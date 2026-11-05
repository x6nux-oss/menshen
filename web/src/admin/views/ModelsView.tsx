// oxlint-disable react/set-state-in-effect -- 草稿态需要跟随服务端返回的值重置（保存后刷新）。
// 模型定价（主管理员）：列表 + 新增；详情页改价、启停、删除。
import { useEffect, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "../../components/ui";
import { useModelMutation } from "../../api/mutations";
import { useMiniState } from "../../api/hooks";
import { filterRows } from "../../lib/filters";
import { SearchField } from "../../components/mobile";
import {
  CardBlock,
  ConfirmButton,
  DataTable,
  InfoList,
  PageHeader,
  StatusBadge,
  Toolbar,
} from "../components";
import type { Column } from "../components";
import { useRunFeedback } from "../feedback";
import { useAdminNav } from "../nav";
import type { Model } from "../../api/types";

export function ModelsView() {
  const state = useMiniState(true);
  const nav = useAdminNav();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  if (!state.data) return null;

  const models = state.data.models ?? [];
  const rows = filterRows(models, q, (m) => m.name);
  const columns: Column<Model>[] = [
    { key: "name", header: "模型名", render: (row) => row.name },
    {
      key: "upstream",
      header: "上游",
      width: 140,
      render: (row) => row.upstream || "—",
    },
    {
      key: "in",
      header: "输入价",
      width: 110,
      align: "right",
      render: (row) => row.prompt_price,
    },
    {
      key: "out",
      header: "输出价",
      width: 110,
      align: "right",
      render: (row) => row.completion_price,
    },
    {
      key: "cr",
      header: "缓存读",
      width: 100,
      align: "right",
      render: (row) => row.cache_read_price,
    },
    {
      key: "cw",
      header: "缓存写",
      width: 100,
      align: "right",
      render: (row) => row.cache_write_price,
    },
    {
      key: "status",
      header: "状态",
      width: 96,
      render: (row) => (
        <StatusBadge
          info={
            row.enabled
              ? { label: "启用", tone: "ok" }
              : { label: "停用", tone: "neutral" }
          }
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="模型定价"
        subtitle={`共 ${models.length} 个；单价用于把开销折算成钱`}
        actions={<Button onClick={() => setOpen(true)}>＋ 新增模型</Button>}
      />
      <Toolbar>
        <SearchField
          value={q}
          onChange={setQ}
          placeholder="搜索模型名"
          className="max-w-[320px]"
        />
      </Toolbar>
      <DataTable
        rows={rows}
        rowKey={(row) => row.name}
        onRowClick={(row) => nav.go({ k: "model", name: row.name })}
        empty={
          <span className="text-[13px] text-muted-foreground">
            没有匹配的模型。
          </span>
        }
        columns={columns}
      />
      <AddModelDialog
        open={open}
        onClose={() => setOpen(false)}
        upstreams={(state.data.upstreams ?? [])
          .filter((u) => u.status)
          .map((u) => u.name)}
      />
    </>
  );
}

function AddModelDialog({
  open,
  onClose,
  upstreams,
}: {
  open: boolean;
  onClose: () => void;
  upstreams: string[];
}) {
  const run = useRunFeedback();
  const mut = useModelMutation();
  const [upstream, setUpstream] = useState(upstreams[0] ?? "");
  const [modelId, setModelId] = useState("");
  const [pp, setPp] = useState("");
  const [cp, setCp] = useState("");
  const [crp, setCrp] = useState("");
  const [cwp, setCwp] = useState("");
  const valid = upstream !== "" && modelId.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增模型</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="addmodel-upstream">上游</Label>
            <Select value={upstream} onValueChange={setUpstream}>
              <SelectTrigger id="addmodel-upstream" aria-label="上游">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {upstreams.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="addmodel-id">模型 ID</Label>
            <Input
              id="addmodel-id"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
            />
            <span className="text-[12px] text-muted-foreground">上游侧的模型 ID，可含 /</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="addmodel-pp">输入价（每百万 token）</Label>
              <Input id="addmodel-pp" value={pp} onChange={(e) => setPp(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="addmodel-cp">输出价</Label>
              <Input id="addmodel-cp" value={cp} onChange={(e) => setCp(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="addmodel-crp">缓存读价</Label>
              <Input id="addmodel-crp" value={crp} onChange={(e) => setCrp(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="addmodel-cwp">缓存写价</Label>
              <Input id="addmodel-cwp" value={cwp} onChange={(e) => setCwp(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={!valid || mut.isPending}
            onClick={() => {
              run(
                mut.mutateAsync({
                  action: "add",
                  upstream,
                  model_id: modelId.trim(),
                  prompt_price: pp.trim(),
                  completion_price: cp.trim(),
                  cache_read_price: crp.trim(),
                  cache_write_price: cwp.trim(),
                }),
                "已新增",
              );
              setModelId("");
              setPp("");
              setCp("");
              setCrp("");
              setCwp("");
              onClose();
            }}
          >
            新增
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModelDetailView({ name }: { name: string }) {
  const state = useMiniState(true);
  const run = useRunFeedback();
  const mut = useModelMutation();
  if (!state.data) return null;

  const model = (state.data.models ?? []).find((m) => m.name === name);
  if (!model) {
    return (
      <CardBlock>
        <span className="text-sm text-muted-foreground">模型不存在。</span>
      </CardBlock>
    );
  }
  return <ModelDetailBody key={model.name} model={model} run={run} mut={mut} />;
}

function ModelDetailBody({
  model,
  run,
  mut,
}: {
  model: Model;
  run: (p: Promise<unknown>, ok?: string) => void;
  mut: ReturnType<typeof useModelMutation>;
}) {
  const [pp, setPp] = useState(String(model.prompt_price));
  const [cp, setCp] = useState(String(model.completion_price));
  const [crp, setCrp] = useState(String(model.cache_read_price));
  const [cwp, setCwp] = useState(String(model.cache_write_price));
  useEffect(() => {
    setPp(String(model.prompt_price));
    setCp(String(model.completion_price));
    setCrp(String(model.cache_read_price));
    setCwp(String(model.cache_write_price));
  }, [model]);

  return (
    <>
      <PageHeader
        title={model.name}
        subtitle={
          model.upstream
            ? `上游 ${model.upstream} · 模型 ID ${model.model_id}`
            : "旧格式模型（无上游前缀）"
        }
        actions={
          <StatusBadge
            info={
              model.enabled
                ? { label: "启用", tone: "ok" }
                : { label: "停用", tone: "neutral" }
            }
          />
        }
      />

      <CardBlock
        title="启用"
        actions={
          <Switch
            aria-label="启用模型"
            checked={model.enabled}
            disabled={mut.isPending}
            onCheckedChange={(checked) =>
              run(
                mut.mutateAsync({
                  action: "update",
                  name: model.name,
                  enabled: checked,
                }),
                checked ? "已启用" : "已停用",
              )
            }
          />
        }
      >
        <span className="text-[13px] text-muted-foreground">
          只有启用的模型能出现在判定/复判模型选择里。
        </span>
      </CardBlock>

      <CardBlock
        title="初判提示词简化为一句话"
        actions={
          <Switch
            aria-label="简化初判提示词"
            checked={model.simple_instructions}
            disabled={mut.isPending}
            onCheckedChange={(checked) =>
              run(
                mut.mutateAsync({
                  action: "update",
                  name: model.name,
                  simple_instructions: checked,
                }),
                checked ? "已简化" : "已还原完整提示词",
              )
            }
          />
        }
      >
        <span className="text-[13px] text-muted-foreground">
          给微调过的初判模型用：is_ad 的 instructions
          换成一句「是不是广告」，判定选项与 state 不变。
          同一判定列表里标没标混着时，每次尝试按当前模型各自生效；复判提示词不受影响。
        </span>
      </CardBlock>

      <CardBlock title="单价">
        <div className="grid max-w-[720px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="model-pp">输入价</Label>
            <Input id="model-pp" value={pp} onChange={(e) => setPp(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="model-cp">输出价</Label>
            <Input id="model-cp" value={cp} onChange={(e) => setCp(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="model-crp">缓存读价</Label>
            <Input id="model-crp" value={crp} onChange={(e) => setCrp(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="model-cwp">缓存写价</Label>
            <Input id="model-cwp" value={cwp} onChange={(e) => setCwp(e.target.value)} />
          </div>
        </div>
        <div className="mt-4">
          <Button
            disabled={mut.isPending}
            onClick={() =>
              run(
                mut.mutateAsync({
                  action: "update",
                  name: model.name,
                  prompt_price: pp.trim(),
                  completion_price: cp.trim(),
                  cache_read_price: crp.trim(),
                  cache_write_price: cwp.trim(),
                }),
                "已保存",
              )
            }
          >
            保存单价
          </Button>
        </div>
      </CardBlock>

      <CardBlock title="其他">
        <InfoList
          items={[
            { label: "模型名", value: model.name },
            { label: "上游", value: model.upstream || "—" },
            { label: "模型 ID", value: model.model_id || "—" },
          ]}
        />
        <div className="mt-4">
          <ConfirmButton
            variant="outlined"
            color="error"
            danger
            title="删除模型"
            description="删除后引用它的判定/复判列表需要重新配置。"
            confirmLabel="删除"
            disabled={mut.isPending}
            onConfirm={() =>
              run(
                mut.mutateAsync({ action: "remove", name: model.name }),
                "已删除",
              )
            }
          >
            删除模型
          </ConfirmButton>
        </div>
      </CardBlock>
    </>
  );
}
