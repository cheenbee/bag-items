import { TokenManager } from './AgentWorkspace.jsx';
import './agent-workspace.css';

const clients = [
  { name: 'WorkBuddy', text: '使用 Streamable HTTP 地址和个人 Bearer 令牌连接。', protocol: '推荐' },
  { name: 'OpenClaw', text: '在 MCP Server 配置中填写服务地址和 Authorization 请求头。', protocol: '支持' },
  { name: '通用 MCP 客户端', text: '优先使用 Streamable HTTP；旧客户端可使用 SSE 兼容入口。', protocol: '标准' },
];

export default function AgentSettings() {
  const copy = value => navigator.clipboard?.writeText(value).catch(() => window.prompt('请复制连接地址', value));
  return <>
    <header className="agent-page-header agent-settings-header"><div><p>SYSTEM / AGENT CONNECTION</p><h1>Agent 接入管理</h1><small>集中管理外部AI客户端、个人MCP令牌和访问权限。业务对话请返回“AI Agent工作台”。</small></div><span className="agent-service-state"><i/>MCP服务正常</span></header>
    <section className="agent-settings-overview">
      <article><small>主协议</small><b>Streamable HTTP</b><span>适合WorkBuddy、OpenClaw和通用MCP客户端</span></article>
      <article><small>写入规则</small><b>预览后确认</b><span>新增和修改不会被AI直接提交</span></article>
      <article><small>安全边界</small><b>永不开放删除</b><span>账号管理与系统设置同样不可调用</span></article>
    </section>
    <div className="agent-settings-layout">
      <TokenManager/>
      <aside className="agent-client-guide">
        <div><small>CLIENT GUIDE</small><h2>客户端连接指南</h2><p>先创建个人令牌，再将连接地址和令牌填写到外部Agent。令牌只显示一次。</p></div>
        <section className="agent-copy-endpoint"><span><small>Streamable HTTP</small><code>{location.origin}/mcp</code></span><button type="button" onClick={() => copy(`${location.origin}/mcp`)}>复制地址</button></section>
        {clients.map(client => <article className="agent-client-card" key={client.name}><span>{client.protocol}</span><div><b>{client.name}</b><p>{client.text}</p></div></article>)}
        <section className="agent-security-note"><b>连接前检查</b><p>只向可信客户端保存个人令牌。首次接入建议先使用“只读查询”权限，确认连接正常后再开放计算或写入。</p></section>
      </aside>
    </div>
  </>;
}
