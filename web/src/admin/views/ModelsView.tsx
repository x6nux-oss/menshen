// oxlint-disable react/set-state-in-effect -- 草稿态需要跟随服务端返回的值重置（保存后刷新）。
// 模型定价（主管理员）：列表 + 新增；详情页改价、启停、删除。
import { useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "../../components/ui";
import { useModelMutation } from "../../api/mutations";
import { useMiniState } from "../../api/hooks";
import { filterRows } from "../../lib/filters";
import { SearchField } from "../../components/mobile";
import {
  CardBlock,
  ConfirmButton,
  InfoList,
  PageHeader,
  StatusBadge,
} from "../components";
import type { Column } from "../components";
import { DataTable } from "../data-table";
import { useRunFeedback } from "../feedback";
import { useAdminNav } from "../nav";
import { REASONING_EFFORTS } from "../../api/types";
import type { Model } from "../../api/types";
import { LocalModelsCard } from "../../components/mobile";
import { FilterChips } from "./list-tools";
import { useSearchHotkey } from "./use-search-hotkey";
import { choiceParam, textParam, useUrlFilter } from "./use-url-filters";

const REASONING_EFFORT_UNSET = "__unset__";
const MODEL_STATES = ["all", "enabled", "disabled"] as const;
const STATE_PARAM = choiceParam(MODEL_STATES);
const SEARCH_PARAM = textParam();

export function ModelsView() {
  const state = useMiniState(true);
  const nav = useAdminNav();
  const [q, setQ] = useUrlFilter("q", "", SEARCH_PARAM);
  const [filter, setFilter] = useUrlFilter<(typeof MODEL_STATES)[number]>(
    "state",
    "all",
    STATE_PARAM,
  );
  const [open, setOpen] = useState(false);
  const searchRef = useSearchHotkey<HTMLDivElement>();
  if (!state.data) return null;

  const models = state.data.models ?? [];
  const rows = filterRows(models, q, (m) => `${m.name} ${m.upstream}`).filter(
    (m) => filter === "all" || (filter === "enabled" ? m.enabled : !m.enabled),
  );
  const columns: Column<Model>[] = [
    {
      key: "name",
      header: "模型",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[12.5px] font-medium">{row.name}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {row.model_id || "—"}
          </p>
        </div>
      ),
    },
    {
      key: "upstream",
      header: "上游",
      width: 140,
      render: (row) => (
        <span className="text-[13px] text-muted-foreground">{row.upstream || "—"}</span>
      ),
    },
    {
      key: "in",
      header: "输入 / 输出",
      width: 150,
      align: "right",
      render: (row) => (
        <div className="font-mono text-[12px] tabular-nums">
          <p>{row.prompt_price}</p>
          <p className="text-muted-foreground">{row.completion_price}</p>
        </div>
      ),
    },
    {
      key: "cache",
      header: "缓存读 / 写",
      width: 130,
      align: "right",
      render: (row) => (
        <div className="font-mono text-[12px] tabular-nums text-muted-foreground">
          <p>{row.cache_read_price}</p>
          <p>{row.cache_write_price}</p>
        </div>
      ),
    },
    {
      key: "effort",
      header: "思考强度",
      width: 110,
      render: (row) =>
        row.reasoning_effort ? (
          <span className="font-mono text-[12px]">{row.reasoning_effort}</span>
        ) : (
          <span className="text-[12.5px] text-muted-foreground">默认</span>
        ),
    },
    {
      key: "status",
      header: "状态",
      width: 90,
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
        subtitle={`${models.length} 个模型 · 单价用于把调用开销折算成钱`}
        actions={<Button onClick={() => setOpen(true)}>＋ 新增模型</Button>}
      />
      {state.data.me.main && <LocalModelsCard />}
      <DataTable
        rows={rows}
        rowKey={(row) => row.name}
        onRowClick={(row) => nav.go({ k: "model", name: row.name })}
        empty={
          <span className="text-[13px] text-muted-foreground">
            {q || filter !== "all" ? "没有匹配的模型。" : "还没有配置模型。"}
          </span>
        }
        columns={columns}
        toolbar={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div ref={searchRef} className="w-full max-w-[320px]">
              <SearchField
                value={q}
                onChange={setQ}
                placeholder="搜索模型名 / 上游"
              />
            </div>
            <FilterChips
              ariaLabel="按模型状态筛选"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "全部", count: models.length },
                {
                  value: "enabled",
                  label: "启用",
                  count: models.filter((m) => m.enabled).length,
                },
                {
                  value: "disabled",
                  label: "停用",
                  count: models.filter((m) => !m.enabled).length,
                },
              ]}
            />
          </div>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span>
              显示 {rows.length} / {models.length} 个
            </span>
            <span>点击行编辑单价与请求参数</span>
          </div>
        }
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
          <DialogDescription>绑定上游并设置每百万 token 的单价。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="addmodel-pp">输入价</Label>
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

  const dirty =
    pp !== String(model.prompt_price) ||
    cp !== String(model.completion_price) ||
    crp !== String(model.cache_read_price) ||
    cwp !== String(model.cache_write_price);

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

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <CardBlock title="单价">
            <p className="mb-3 text-[12.5px] text-muted-foreground">
              每百万 token 的价格；0 表示该维度不计费。
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
              <PriceField id="model-pp" label="输入价" value={pp} onChange={setPp} />
              <PriceField id="model-cp" label="输出价" value={cp} onChange={setCp} />
              <PriceField id="model-crp" label="缓存读价" value={crp} onChange={setCrp} />
              <PriceField id="model-cwp" label="缓存写价" value={cwp} onChange={setCwp} />
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button
                disabled={mut.isPending || !dirty}
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
              {dirty && <span className="text-[12px] text-muted-foreground">有未保存的改动</span>}
            </div>
          </CardBlock>

          <CardBlock title="请求行为">
            <div className="divide-y divide-border">
              <ToggleSetting
                label="启用模型"
                hint="只有启用的模型能出现在判定/复判模型选择里。"
                checked={model.enabled}
                disabled={mut.isPending}
                onChange={(checked) =>
                  run(
                    mut.mutateAsync({ action: "update", name: model.name, enabled: checked }),
                    checked ? "已启用" : "已停用",
                  )
                }
              />
              <ToggleSetting
                label="初判提示词简化为一句话"
                hint="给微调过的初判模型用：is_ad 的 instructions 换成一句「是不是广告」，判定选项与 state 不变。同一判定列表里标没标混着时，每次尝试按当前模型各自生效；复判提示词不受影响。"
                checked={model.simple_instructions}
                disabled={mut.isPending}
                onChange={(checked) =>
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
              <div className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-start sm:gap-6">
                <div>
                  <p className="text-[13.5px] font-medium">思考强度</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                    不填则按模型默认。OpenAI、Responses、Anthropic 会翻成各自字段；模型不认时自动去掉重发并记警告日志。
                  </p>
                </div>
                <Select
                  value={
                    model.reasoning_effort === "" ? REASONING_EFFORT_UNSET : model.reasoning_effort
                  }
                  disabled={mut.isPending}
                  onValueChange={(next) => {
                    const effort = next === REASONING_EFFORT_UNSET ? "" : next;
                    run(
                      mut.mutateAsync({
                        action: "update",
                        name: model.name,
                        reasoning_effort: effort,
                      }),
                      effort ? `思考强度 ${effort}` : "不传思考强度",
                    );
                  }}
                >
                  <SelectTrigger aria-label="思考强度">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={REASONING_EFFORT_UNSET}>不填</SelectItem>
                    {REASONING_EFFORTS.map((effort) => (
                      <SelectItem key={effort} value={effort}>
                        {effort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardBlock>
        </div>

        <div className="min-w-0">
          <CardBlock title="标识">
            <InfoList
              items={[
                { label: "模型名", value: <span className="font-mono text-[12.5px]">{model.name}</span> },
                { label: "上游", value: model.upstream || "—" },
                { label: "模型 ID", value: <span className="font-mono text-[12.5px]">{model.model_id || "—"}</span> },
              ]}
            />
          </CardBlock>
          <CardBlock title="危险操作">
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
              删除后引用它的判定/复判列表需要重新配置。
            </p>
            <ConfirmButton
              variant="outlined"
              color="error"
              danger
              title="删除模型"
              description="删除后引用它的判定/复判列表需要重新配置。"
              confirmLabel="删除"
              disabled={mut.isPending}
              onConfirm={() =>
                run(mut.mutateAsync({ action: "remove", name: model.name }), "已删除")
              }
            >
              删除模型
            </ConfirmButton>
          </CardBlock>
        </div>
      </div>
    </>
  );
}

function PriceField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[12px] text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-[13px] tabular-nums"
      />
    </div>
  );
}

function ToggleSetting({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
      <div className="flex-1">
        <p className="text-[13.5px] font-medium">{label}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
