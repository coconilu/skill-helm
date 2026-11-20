import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { EvalCaseInput, EvalEnvironment, EvalRun, EvalSkillRun, EvalSuite } from "./types";

interface Props {
  selection: { names?: string[]; all?: boolean; resumeId?: string };
  onClose: () => void;
}

const RUN_STATUS: Record<EvalRun["status"], string> = {
  preparing: "正在生成用例",
  draft: "等待确认",
  queued: "等待执行",
  running: "正在评估",
  completed: "已完成",
  cancelled: "已取消",
  failed: "任务失败",
};

const SKILL_STATUS: Record<EvalSkillRun["status"], string> = {
  pending: "等待准备",
  preparing: "生成用例中",
  ready: "已就绪",
  running: "运行中",
  passed: "通过",
  failed: "有失败",
  error: "执行错误",
  cancelled: "已取消",
};

const CASE_KIND: Record<EvalCaseInput["kind"], string> = {
  trigger: "触发边界",
  boundary: "边界情况",
  core: "核心任务",
  regression: "回归用例",
};

function percent(value?: number): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

export default function EvalPanel({ selection, onClose }: Props) {
  const [environment, setEnvironment] = useState<EvalEnvironment | null>(null);
  const [run, setRun] = useState<EvalRun | null>(null);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [suite, setSuite] = useState<EvalSuite | null>(null);
  const [draftCases, setDraftCases] = useState<EvalCaseInput[]>([]);
  const [caseId, setCaseId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [resumeChecked, setResumeChecked] = useState(false);

  const loadEnvironment = useCallback(() => {
    api
      .evalEnvironment()
      .then(setEnvironment)
      .catch((e: Error) => setNotice(e.message));
  }, []);

  useEffect(loadEnvironment, [loadEnvironment]);

  useEffect(() => {
    api
      .evalRuns()
      .then(async (runs) => {
        const id =
          selection.resumeId ??
          runs.find((item) => ["preparing", "queued", "running"].includes(item.status))?.id;
        if (id) setRun(await api.evalRun(id));
      })
      .catch((e: Error) => setNotice(e.message))
      .finally(() => setResumeChecked(true));
  }, [selection.resumeId]);

  const runId = run?.id;
  const runStatus = run?.status;
  useEffect(() => {
    if (!runId || !runStatus || !["preparing", "queued", "running"].includes(runStatus)) return;
    const timer = setInterval(() => {
      api
        .evalRun(runId)
        .then(setRun)
        .catch((e: Error) => setNotice(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [runId, runStatus]);

  const selectedSkill = run?.skills.find((s) => s.name === selectedName);
  const selectedCase =
    run?.status === "draft"
      ? draftCases.find((c) => c.id === caseId)
      : selectedSkill?.cases.find((c) => c.id === caseId);

  const openSkill = useCallback(async (skill: EvalSkillRun, status?: EvalRun["status"]) => {
    setSelectedName(skill.name);
    setCaseId("");
    if (status === "draft" || !status) {
      try {
        const loaded = await api.evalSuite(skill.name);
        setSuite(loaded);
        setDraftCases(loaded.cases);
        setCaseId(loaded.cases[0]?.id ?? "");
        setDirty(false);
      } catch (e) {
        setNotice((e as Error).message);
      }
    } else {
      setSuite(null);
      setCaseId(skill.cases[0]?.id ?? "");
    }
  }, []);

  useEffect(() => {
    if (run?.status !== "draft" || selectedName) return;
    const first = run.skills.find((s) => s.status === "ready");
    if (first) void openSkill(first, "draft");
  }, [run?.status, run?.skills, selectedName, openSkill]);

  const perform = async (action: () => Promise<EvalRun>) => {
    setBusy(true);
    setNotice("");
    try {
      setRun(await action());
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const prepare = () =>
    perform(() =>
      api.evalPrepare({
        names: selection.names,
        all: selection.all,
        enabledOnly,
      }),
    );

  const updateCase = (patch: Partial<EvalCaseInput>) => {
    if (!caseId) return;
    setDraftCases((cases) => cases.map((c) => (c.id === caseId ? { ...c, ...patch } : c)));
    setDirty(true);
  };

  const saveSuite = async () => {
    if (!suite) return;
    setBusy(true);
    try {
      const saved = await api.evalSaveSuite(suite.name, draftCases);
      setSuite(saved);
      setDraftCases(saved.cases);
      setDirty(false);
      if (run) setRun(await api.evalRun(run.id));
      setNotice("评测用例已保存");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addCase = () => {
    const id = `case-${draftCases.length + 1}`;
    const next: EvalCaseInput = {
      id,
      title: "新评测用例",
      kind: "core",
      description: "",
      prompt: "",
      mustContain: [],
      mustNotContain: [],
      rubric: "回答应准确完成输入任务，并遵守 Skill 的约束。",
    };
    setDraftCases([...draftCases, next]);
    setCaseId(id);
    setDirty(true);
  };

  const removeCase = () => {
    if (!caseId || draftCases.length <= 1) return;
    const next = draftCases.filter((c) => c.id !== caseId);
    setDraftCases(next);
    setCaseId(next[0]?.id ?? "");
    setDirty(true);
  };

  const exportReport = () => {
    if (!run) return;
    const lines = [
      `# Skill Helm 批量评估报告`,
      "",
      `- 任务：${run.id}`,
      `- 引擎：本地 Codex`,
      `- 状态：${RUN_STATUS[run.status]}`,
      `- 创建时间：${run.createdAt}`,
      "",
      "| Skill | 用例通过 | 无 Skill 通过率 | 有 Skill 通过率 | 提升 | 状态 |",
      "|---|---:|---:|---:|---:|---|",
      ...run.skills.map(
        (s) =>
          `| ${s.name} | ${s.passed}/${s.caseCount} | ${percent(s.withoutSkillPassRate)} | ${percent(s.withSkillPassRate)} | ${s.improvement === undefined ? "—" : `${(s.improvement * 100).toFixed(1)}pp`} | ${SKILL_STATUS[s.status]} |`,
      ),
      "",
      "## 失败详情",
      "",
    ];
    for (const skill of run.skills) {
      for (const c of skill.cases.filter((item) => item.status !== "PASS")) {
        lines.push(
          `### ${skill.name} / ${c.title}`,
          "",
          `- 状态：${c.status}`,
          `- 输入：${c.prompt}`,
          `- 实际：${c.response || "—"}`,
          `- 依据：${c.evidence.join("；") || skill.error || "—"}`,
          "",
        );
      }
      if (skill.error) lines.push(`### ${skill.name}`, "", skill.error, "");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `skill-helm-eval-${run.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    const skills = run?.skills ?? [];
    return {
      passed: skills.filter((s) => s.status === "passed").length,
      failed: skills.filter((s) => s.status === "failed").length,
      errors: skills.filter((s) => s.status === "error").length,
      casesPassed: skills.reduce((sum, s) => sum + s.passed, 0),
      cases: skills.reduce((sum, s) => sum + s.caseCount, 0),
    };
  }, [run]);

  const terminal = run && ["completed", "cancelled", "failed"].includes(run.status);
  const progress = run?.totalCaseRuns
    ? Math.round((run.completedCaseRuns / run.totalCaseRuns) * 100)
    : 0;

  return (
    <div className="eval-mask">
      <section className="eval-panel">
        <header className="eval-header">
          <div>
            <h2>Skill 批量评估</h2>
            <span className="dim">
              {run
                ? `${run.skills.length} 个 Skill`
                : selection.all
                  ? `全部 Skill${enabledOnly ? "（仅已启用）" : ""}`
                  : `已选 ${selection.names?.length ?? 0} 个 Skill`}
              {" · 本地 Codex · 快速评估"}
            </span>
          </div>
          <button className="close" onClick={onClose}>
            ×
          </button>
        </header>

        {notice && <div className="eval-notice">{notice}</div>}

        {!run && !resumeChecked && <p className="dim">正在恢复最近任务…</p>}
        {!run && resumeChecked && (
          <div className="eval-setup">
            <h3>执行环境</h3>
            <div className="env-grid">
              <div className={environment?.codex.authenticated ? "env-card ready" : "env-card"}>
                <b>本地 Codex</b>
                <span>{environment?.codex.message ?? "正在检测…"}</span>
                {environment?.codex.version && <small>{environment.codex.version}</small>}
              </div>
              <div className={environment?.skillUp.installed ? "env-card ready" : "env-card"}>
                <b>skill-up</b>
                <span>{environment?.skillUp.message ?? "正在检测…"}</span>
                {environment?.skillUp.version && <small>{environment.skillUp.version}</small>}
              </div>
            </div>
            {environment && !environment.skillUp.installed && (
              <p className="eval-help">
                安装地址：<code>https://github.com/alibaba/skill-up/releases</code>
                。安装后重启 Skill Helm。
              </p>
            )}
            <label className="check-line">
              <input
                type="checkbox"
                checked={enabledOnly}
                onChange={(e) => setEnabledOnly(e.target.checked)}
              />
              仅评估已启用的 Skill
            </label>
            <p className="dim">
              先为每个 Skill 生成或读取评测用例；确认用例后才会调用模型执行。用例包含有无 Skill
              两组对照。
            </p>
            <div className="eval-actions">
              <button onClick={loadEnvironment}>重新检测环境</button>
              <button className="primary" disabled={busy} onClick={prepare}>
                {busy ? "正在创建…" : "生成评估方案"}
              </button>
            </div>
          </div>
        )}

        {run && (
          <>
            <div className="eval-run-head">
              <span className={`run-status ${run.status}`}>{RUN_STATUS[run.status]}</span>
              <span className="mono">{run.id}</span>
              {run.currentSkill && <span>当前：{run.currentSkill}</span>}
              <div className="eval-actions">
                {run.status === "draft" && (
                  <button
                    className="primary"
                    disabled={busy || !environment?.ready || dirty}
                    title={
                      !environment?.ready
                        ? "请先准备好本地 Codex 和 skill-up"
                        : dirty
                          ? "请先保存用例"
                          : ""
                    }
                    onClick={() => perform(() => api.evalStart(run.id))}
                  >
                    开始批量评估
                  </button>
                )}
                {["preparing", "queued", "running"].includes(run.status) && (
                  <button className="danger" onClick={() => perform(() => api.evalCancel(run.id))}>
                    取消任务
                  </button>
                )}
                {terminal && (
                  <>
                    <button onClick={exportReport}>导出汇总报告</button>
                    <button onClick={() => void api.evalOpen(run.id)}>打开报告目录</button>
                    {run.skills.some((s) =>
                      ["failed", "error", "cancelled"].includes(s.status),
                    ) && (
                      <button
                        className="primary"
                        disabled={busy || !environment?.ready}
                        onClick={() => perform(() => api.evalRetry(run.id))}
                      >
                        重试失败项
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {["queued", "running"].includes(run.status) && (
              <div className="eval-progress">
                <progress max={100} value={progress} />
                <span>
                  {run.completedSkills}/{run.skills.length} 个 Skill · {run.completedCaseRuns}/
                  {run.totalCaseRuns} 次执行（{progress}%）
                </span>
              </div>
            )}

            <div className="eval-summary">
              <div>
                <b>{run.skills.length}</b>
                <span>Skill</span>
              </div>
              <div>
                <b>
                  {summary.casesPassed}/{summary.cases}
                </b>
                <span>用例通过</span>
              </div>
              <div>
                <b>{summary.failed}</b>
                <span>有失败</span>
              </div>
              <div>
                <b>{summary.errors}</b>
                <span>执行错误</span>
              </div>
            </div>

            <div className="eval-table-wrap">
              <table className="grid eval-grid">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>用例通过</th>
                    <th>无 Skill</th>
                    <th>有 Skill</th>
                    <th>提升</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {run.skills.map((skill) => (
                    <tr
                      key={skill.name}
                      className={selectedName === skill.name ? "selected" : ""}
                      onClick={() => void openSkill(skill, run.status)}
                    >
                      <td className="mono">{skill.name}</td>
                      <td>
                        {skill.passed}/{skill.caseCount}
                      </td>
                      <td>{percent(skill.withoutSkillPassRate)}</td>
                      <td>{percent(skill.withSkillPassRate)}</td>
                      <td>
                        {skill.improvement === undefined
                          ? "—"
                          : `${(skill.improvement * 100).toFixed(1)}pp`}
                      </td>
                      <td>
                        <span className={`skill-eval-status ${skill.status}`}>
                          {SKILL_STATUS[skill.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {run.error && <div className="eval-error">{run.error}</div>}

            {selectedSkill?.error && (
              <div className="eval-error">
                <b>{selectedSkill.name}</b>：{selectedSkill.error}
              </div>
            )}

            {run.status === "draft" && suite && (
              <div className="suite-editor">
                <div className="case-list">
                  <div className="case-list-head">
                    <b>{suite.name} 的用例</b>
                    <button disabled={!suite.managed} onClick={addCase}>
                      添加
                    </button>
                  </div>
                  {draftCases.map((c) => (
                    <button
                      key={c.id}
                      className={caseId === c.id ? "case-item active" : "case-item"}
                      onClick={() => setCaseId(c.id)}
                    >
                      <span>{c.title}</span>
                      <small>{CASE_KIND[c.kind]}</small>
                    </button>
                  ))}
                </div>
                {selectedCase && "rubric" in selectedCase && (
                  <div className="case-editor">
                    {!suite.managed && (
                      <p className="eval-help">
                        这是已有自定义 evals，请在 YAML 中编辑，Skill Helm 不会覆盖它。
                      </p>
                    )}
                    <label>标题</label>
                    <input
                      disabled={!suite.managed}
                      value={selectedCase.title}
                      onChange={(e) => updateCase({ title: e.target.value })}
                    />
                    <label>输入</label>
                    <textarea
                      disabled={!suite.managed}
                      rows={5}
                      value={selectedCase.prompt}
                      onChange={(e) => updateCase({ prompt: e.target.value })}
                    />
                    <label>语义评分标准</label>
                    <textarea
                      disabled={!suite.managed}
                      rows={5}
                      value={selectedCase.rubric}
                      onChange={(e) => updateCase({ rubric: e.target.value })}
                    />
                    <label>必须包含（每行一个，可选）</label>
                    <textarea
                      disabled={!suite.managed}
                      rows={2}
                      value={selectedCase.mustContain.join("\n")}
                      onChange={(e) =>
                        updateCase({ mustContain: e.target.value.split("\n").filter(Boolean) })
                      }
                    />
                    <div className="eval-actions">
                      <button
                        disabled={!suite.managed || draftCases.length <= 1}
                        onClick={removeCase}
                      >
                        删除用例
                      </button>
                      <button
                        className="primary"
                        disabled={!suite.managed || !dirty || busy}
                        onClick={saveSuite}
                      >
                        保存用例
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {run.status !== "draft" && selectedSkill && selectedSkill.cases.length > 0 && (
              <div className="result-detail">
                <div className="case-list">
                  {selectedSkill.cases.map((c) => (
                    <button
                      key={c.id}
                      className={caseId === c.id ? "case-item active" : "case-item"}
                      onClick={() => setCaseId(c.id)}
                    >
                      <span>{c.title}</span>
                      <small className={c.status === "PASS" ? "ok" : "error"}>{c.status}</small>
                    </button>
                  ))}
                </div>
                {selectedCase && !("rubric" in selectedCase) && (
                  <div className="case-result">
                    <h3>{selectedCase.title}</h3>
                    <div className="case-badges">
                      <span>有 Skill：{selectedCase.status}</span>
                      <span>无 Skill：{selectedCase.baselineStatus ?? "—"}</span>
                    </div>
                    <label>输入</label>
                    <pre>{selectedCase.prompt || "—"}</pre>
                    <label>实际输出</label>
                    <pre>{selectedCase.response || "—"}</pre>
                    {selectedCase.evidence.length > 0 && (
                      <>
                        <label>判分依据</label>
                        <pre>{selectedCase.evidence.join("\n")}</pre>
                      </>
                    )}
                    {selectedCase.baselineResponse && (
                      <details>
                        <summary>查看无 Skill 对照输出</summary>
                        <pre>{selectedCase.baselineResponse}</pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
