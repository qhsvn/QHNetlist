// Console AI trực tiếp: dòng lệnh đánh số, model, token, stream JSON thời gian thực, duyệt patch.
import { COMPONENT_TYPES } from '../core/library';
import { useEffect, useRef, useState } from 'react';
import { PROVIDERS } from '../ai/providers';
import { approveProposal, askAIToFix, cancelAI, finishBuild, rejectProposal, sendToAI } from './actions';
import { setState, useStore, type LogLine } from './store';

const QUICK = [
  'Giải thích mạch hiện tại',
  'Tìm lỗi và đề xuất sửa',
  'Thiết kế mạch LED nhấp nháy 5 V bằng RC',
  'Tạo bộ lọc thông thấp RC fc = 1 kHz',
  'Mạch khuếch đại không đảo gain 10 dùng op-amp',
];

function fmtT(t: number) {
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}.${(t % 60).toFixed(3).padStart(6, '0')}`;
}

const TYPE_ALT = [...COMPONENT_TYPES].sort((a, b) => b.length - a.length).join('|');
const HL_RE = new RegExp(String.raw`("(?:[^"\\]|\\.)*"|#.*$|\b\d+(?:\.\d+)?\b|netlist\.\w+|\b(?:${TYPE_ALT})\b)`, 'g');

function Highlight({ code }: { code: string }) {
  // tô màu đơn giản: từ khoá, chuỗi, số, comment
  const parts = code.split(HL_RE);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (p.startsWith('"')) return <span key={i} className="tk-str">{p}</span>;
        if (p.startsWith('#')) return <span key={i} className="tk-com">{p}</span>;
        if (/^\d/.test(p)) return <span key={i} className="tk-num">{p}</span>;
        if (p.startsWith('netlist.')) return <span key={i} className="tk-fn">{p}</span>;
        if (/^[a-z][a-z0-9_]*$/.test(p) && i % 2 === 1) return <span key={i} className="tk-type">{p}</span>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Line({ l, n }: { l: LogLine; n: number }) {
  return (
    <div className={`cl cl-${l.kind}`}>
      <span className="ln">{n}</span>
      {l.kind === 'code' ? (
        <span className="code"><Highlight code={l.text} /></span>
      ) : l.kind === 'explain' ? (
        <span className="explain">{l.text}</span>
      ) : (
        <span>
          <span className="ts">{fmtT(l.t)}</span>
          {l.tag && <span className={`tag tag-${l.kind}`}>{l.tag}</span>}
          <span className="msg">{l.text}</span>
        </span>
      )}
    </div>
  );
}

export function AIConsole() {
  const logLines = useStore((s) => s.log);
  const streamText = useStore((s) => s.streamText);
  const busy = useStore((s) => s.busy);
  const pending = useStore((s) => s.pending);
  const build = useStore((s) => s.build);
  const ai = useStore((s) => s.ai);
  const tokens = useStore((s) => s.tokens);
  const nComps = useStore((s) => s.doc.components.length);
  const [input, setInput] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logLines.length, streamText, pending]);

  const submit = () => {
    if (!input.trim() || busy) return;
    sendToAI(input);
    setInput('');
  };

  const model = ai.models[ai.provider];
  const live = busy ? 'STREAM' : build ? 'BUILD' : 'LIVE';

  return (
    <aside className="console">
      <div className="console-bar">
        <span className="dots"><i /><i /><i /></span>
        <span className="console-path">~/netlist — {model || 'chưa chọn model'}</span>
        <span className={`live live-${live.toLowerCase()}`}>● {live}</span>
      </div>
      <div className="console-hero">
        <div className="hero-badge">◆ Netlist AI Console</div>
        <h1 className="hero-title">NETLIST</h1>
        <div className="hero-sub">● {PROVIDERS[ai.provider].name} · <b>{model}</b></div>
        <div className="hero-sub">● mạch hiện tại · {nComps} linh kiện · {tokens.requests} lượt AI · {(tokens.input + tokens.output).toLocaleString('vi-VN')} tok</div>
      </div>
      <div className="console-body" ref={scroller}>
        {logLines.length === 0 && (
          <div className="console-empty">
            <p>Mô tả mạch bạn muốn, AI sẽ đề xuất từng thao tác. Bạn duyệt, rồi xem mạch được dựng lên từng bước.</p>
            <p>Chưa có API key? Bấm ⚙ để chọn nhà cung cấp: Claude, OpenAI, Gemini hoặc Ollama chạy cục bộ.</p>
          </div>
        )}
        {logLines.map((l, i) => <Line key={l.id} l={l} n={i + 1} />)}
        {busy && (
          <div className="cl cl-stream">
            <span className="ln">{logLines.length + 1}</span>
            <span className="stream-text">{streamText.slice(-1800) || 'đang suy nghĩ'}<span className="caret">▋</span></span>
          </div>
        )}
        {pending && !build && (
          <div className="proposal">
            <div className="proposal-head">{pending.error ? '✗ Patch không hợp lệ' : `Patch · ${pending.proposal.operations.length} thao tác · rev ${pending.proposal.baseRevision}`}</div>
            {pending.error ? (
              <>
                <div className="proposal-err">{pending.error}</div>
                <div className="proposal-actions">
                  <button className="btn-accent" onClick={askAIToFix}>Nhờ AI sửa</button>
                  <button onClick={rejectProposal}>Bỏ qua</button>
                </div>
              </>
            ) : (
              <div className="proposal-actions">
                <button className="btn-accent" onClick={() => approveProposal()}>▶ Dựng mạch</button>
                <button onClick={() => approveProposal(60)}>Dựng nhanh</button>
                <button onClick={rejectProposal}>Từ chối</button>
              </div>
            )}
          </div>
        )}
        {build && (
          <div className="proposal">
            <div className="proposal-head">Đang dựng {build.index}/{build.steps.length}</div>
            <div className="proposal-actions"><button onClick={finishBuild}>Bỏ qua hiệu ứng</button></div>
          </div>
        )}
      </div>
      <div className="console-quick">
        {QUICK.map((q) => (
          <button key={q} disabled={busy} onClick={() => sendToAI(q)}>{q}</button>
        ))}
      </div>
      <div className="console-input">
        <textarea
          value={input}
          placeholder="Ví dụ: thêm tụ 100nF lọc nguồn cho V1, hoặc thiết kế mạch sạc tụ..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } e.stopPropagation(); }}
          rows={2}
        />
        <div className="console-input-actions">
          <button className="icon" title="Cài đặt AI và ngspice" onClick={() => setState({ settingsOpen: true })}>⚙</button>
          {busy ? <button className="btn-stop" onClick={cancelAI}>■ Dừng</button> : <button className="btn-accent" onClick={submit} disabled={!input.trim()}>Gửi ↵</button>}
        </div>
      </div>
      <div className="console-status">
        <span>PLACE · {build ? `${build.index}/${build.steps.length}` : `${nComps}/${nComps}`}</span>
        <span>{busy ? `~${tokens.live.toLocaleString('vi-VN')} tok` : `${(tokens.lastLatencyMs / 1000).toFixed(1)} s`}</span>
        <span>{ai.provider}</span>
      </div>
    </aside>
  );
}
