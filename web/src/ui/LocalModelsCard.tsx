// 本地视觉模型：主管理员一键下载并启用 OCR/NSFW，或分别启停、调整 NSFW 阈值。
// Telegram Mini App 与桌面面板共用同一张卡；下载中轮询状态。
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import { useLocalModels } from "../api/hooks";
import { useLocalModelsMutation } from "../api/mutations";
import type { LocalModelStatus } from "../api/types";
import { SectionCard } from "./SectionCard";
import { useToast } from "./Toast";

export function LocalModelsCard() {
  const status = useLocalModels();
  const mut = useLocalModelsMutation();
  const toast = useToast();
  const data = status.data;
  const busy = mut.isPending || data?.downloading === true;

  if (status.isPending) {
    return (
      <SectionCard title="本地视觉模型">
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>
          <CircularProgress size={18} />
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
            正在读取本地模型状态…
          </Typography>
        </Box>
      </SectionCard>
    );
  }

  if (status.isError || !data) {
    const message =
      status.error instanceof Error ? status.error.message : "加载失败";
    return (
      <SectionCard title="本地视觉模型">
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void status.refetch()}>
              重试
            </Button>
          }
        >
          {message}
        </Alert>
      </SectionCard>
    );
  }

  function download() {
    mut.mutate(
      { action: "download" },
      {
        onSuccess: () => toast("已开始下载；完成后会自动启用两个模型"),
        onError: (err) => toast(err.message),
      },
    );
  }

  function toggle(model: LocalModelStatus, enabled: boolean) {
    mut.mutate(
      { action: "configure", model: model.id, enabled },
      {
        onSuccess: () => toast(enabled ? "已启用" : "已停用"),
        onError: (err) => toast(err.message),
      },
    );
  }

  function saveThreshold(threshold: number) {
    mut.mutate(
      { action: "configure", threshold },
      {
        onSuccess: () => toast("已保存阈值"),
        onError: (err) => toast(err.message),
      },
    );
  }

  const percent =
    data.total_bytes > 0
      ? Math.min(100, (data.downloaded_bytes / data.total_bytes) * 100)
      : 0;

  return (
    <SectionCard title="本地视觉模型">
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.7 }}>
          离线 OCR（PP-OCRv6 small）与 NSFW 分类（Marqo）。下载和启用仅主管理员可操作；
          已配置的远程模型仍作为失败回退。
        </Typography>

        {data.error !== "" && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {data.error}
          </Alert>
        )}

        {data.downloading && (
          <Box sx={{ mt: 1.5 }}>
            <LinearProgress
              variant={data.total_bytes > 0 ? "determinate" : "indeterminate"}
              value={percent}
              aria-label="模型下载进度"
            />
            <Typography sx={{ mt: 0.5, fontSize: 12, color: "text.secondary" }}>
              {formatBytes(data.downloaded_bytes)}
              {data.total_bytes > 0 ? ` / ${formatBytes(data.total_bytes)}` : ""}
            </Typography>
          </Box>
        )}

        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {data.models.length === 0 && (
            <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
              暂无本地模型清单。
            </Typography>
          )}
          {data.models.map((model) => (
            <Box
              key={model.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                py: 1,
                borderTop: "1px solid",
                borderColor: "divider",
                "&:first-of-type": { borderTop: 0 },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                  {model.name}
                </Typography>
                <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
                  {model.ready ? "已就绪" : "未下载"} ·{" "}
                  {formatBytes(model.size_bytes)}
                </Typography>
              </Box>
              <Switch
                checked={model.enabled}
                disabled={busy || (!model.ready && !model.enabled)}
                onChange={(e) => toggle(model, e.target.checked)}
                slotProps={{
                  input: { "aria-label": `${model.enabled ? "停用" : "启用"} ${model.name}` },
                }}
              />
            </Box>
          ))}
        </Stack>

        <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
          <Button
            variant="contained"
            disabled={busy}
            loading={mut.isPending}
            onClick={download}
          >
            {data.error !== "" ? "重试下载" : "一键下载并启用"}
          </Button>
        </Box>

        <ThresholdEditor
          key={data.nsfw_threshold}
          value={data.nsfw_threshold}
          disabled={busy}
          onSave={saveThreshold}
        />
      </Box>
    </SectionCard>
  );
}

function ThresholdEditor({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (threshold: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const parsed = Number(draft);
  const valid =
    /^\d+$/.test(draft.trim()) && parsed >= 1 && parsed <= 100;

  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, mt: 2 }}>
      <TextField
        size="small"
        label="NSFW 阈值（%）"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        slotProps={{
          htmlInput: { inputMode: "numeric", min: 1, max: 100 },
        }}
        helperText="1-100；达到该概率才作为色情证据送判"
        sx={{ maxWidth: 220 }}
      />
      <Button
        variant="outlined"
        disabled={disabled || !valid}
        onClick={() => onSave(parsed)}
        sx={{ mt: 0.5 }}
      >
        保存阈值
      </Button>
    </Box>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
