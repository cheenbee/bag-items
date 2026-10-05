import { useEffect, useMemo, useState } from 'react';
import { api } from './api-client.js';
import './system-settings.css';

const tabs = [
  ['company', '公司信息', '企业资料与单据抬头'],
  ['brand', '品牌标识', 'Logo 与系统名称'],
  ['service', '售后信息', '售后负责人及展示方式'],
  ['security', '账户安全', '修改当前账户密码'],
];

const fileToDataUrl = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

export default function SystemSettings({ user, onSettingsChanged, onPasswordChanged, userManagement }) {
  const [activeTab, setActiveTab] = useState('company');
  const [settings, setSettings] = useState(null);
  const [editable, setEditable] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState('');
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });

  useEffect(() => {
    api('/v1/system-settings')
      .then(result => { setSettings(result.settings); setEditable(result.editable); })
      .catch(error => setMessage(error.message));
  }, []);

  const completeness = useMemo(() => {
    if (!settings) return 0;
    const keys = ['companyName', 'companyShortName', 'phone', 'address', 'logoUrl', 'afterSalesName', 'afterSalesPhone', 'serviceHours'];
    return Math.round(keys.filter(key => String(settings[key] || '').trim()).length / keys.length * 100);
  }, [settings]);

  const patch = (key, value) => setSettings(current => ({ ...current, [key]: value }));
  const save = async () => {
    if (!editable) return;
    try {
      setBusy(true); setMessage('');
      const result = await api('/v1/system-settings', { method: 'PUT', body: JSON.stringify(settings) });
      setSettings(result.settings);
      onSettingsChanged?.(result.settings);
      setMessage('系统设置已保存');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  const upload = async (file, type) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setMessage('仅支持 JPG、PNG 或 WebP 图片');
    if (file.size > 30 * 1024 * 1024) return setMessage('图片不能超过 30MB');
    try {
      setUploading(type); setMessage('');
      const result = await api('/uploads/images', { method: 'POST', body: JSON.stringify({ dataUrl: await fileToDataUrl(file) }) });
      if (type === 'logo') setSettings(current => ({ ...current, logoUrl: result.url, logoThumbnailUrl: result.thumbnailUrl || result.url }));
      else patch('afterSalesQrUrl', result.url);
    } catch (error) { setMessage(error.message); }
    finally { setUploading(''); }
  };

  const changePassword = async event => {
    event.preventDefault();
    if (password.newPassword !== password.confirmPassword) return setMessage('两次输入的新密码不一致');
    try {
      setBusy(true); setMessage('');
      await api('/v1/auth/password', { method: 'PUT', body: JSON.stringify(password) });
      setMessage('密码已修改，请重新登录');
      setTimeout(() => onPasswordChanged?.(), 800);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };

  if (!settings) return <div className="loading">正在加载系统设置…</div>;
  const field = (label, key, placeholder = '', type = 'text') => <label><span>{label}</span><input type={type} value={settings[key] || ''} placeholder={placeholder} disabled={!editable} onChange={event => patch(key, event.target.value)} /></label>;

  return <>
    <header className="settings-page-header">
      <div><p>SYSTEM / COMPANY PROFILE</p><h1>系统设置</h1></div>
      <div className="settings-completeness"><span>资料完整度</span><b>{completeness}%</b><i><em style={{ width: `${completeness}%` }} /></i></div>
    </header>
    <section className="settings-shell">
      <aside className="settings-tabs">
        <div className="settings-brand-card">
          <span>{settings.logoThumbnailUrl || settings.logoUrl ? <img src={settings.logoThumbnailUrl || settings.logoUrl} alt="公司 Logo" /> : (settings.companyShortName || '知源').slice(0, 2)}</span>
          <div><b>{settings.companyShortName || '知源'}</b><small>{settings.systemName || '知源 BPMS'}</small></div>
        </div>
        <nav>{tabs.map(([key, label, detail]) => <button className={activeTab === key ? 'active' : ''} key={key} onClick={() => { setActiveTab(key); setMessage(''); }}><b>{label}</b><small>{detail}</small><i>›</i></button>)}</nav>
        <div className="settings-access-note"><b>{editable ? '管理员模式' : '只读模式'}</b><span>{editable ? '可修改公司与展示资料' : '公司资料仅管理员可修改'}</span></div>
      </aside>

      <div className="settings-content panel">
        {activeTab === 'company' && <section className="settings-section">
          <div className="settings-section-title"><div><p>COMPANY INFORMATION</p><h2>公司信息</h2><span>用于后台展示、配货清单、成本单及打印文件。</span></div></div>
          <div className="settings-form-grid">{field('公司全称', 'companyName', '填写营业执照上的公司名称')}{field('公司简称', 'companyShortName', '用于导航栏与移动端显示')}{field('联系电话', 'phone')}{field('联系邮箱', 'email', 'service@example.com', 'email')}<label className="full"><span>公司地址</span><input value={settings.address || ''} disabled={!editable} onChange={event => patch('address', event.target.value)} /></label><label className="full"><span>公司简介</span><textarea value={settings.description || ''} disabled={!editable} onChange={event => patch('description', event.target.value)} placeholder="简要说明公司业务、优势或服务范围" /></label></div>
        </section>}

        {activeTab === 'brand' && <section className="settings-section">
          <div className="settings-section-title"><div><p>BRAND IDENTITY</p><h2>公司 Logo 与系统展示</h2><span>一次上传，同时预览侧栏、手机顶部栏和打印单据效果。</span></div></div>
          <div className="logo-setting-layout">
            <div className="logo-uploader"><div className="logo-preview">{settings.logoUrl ? <img src={settings.logoUrl} alt="公司 Logo" /> : <span>{(settings.companyShortName || '知源').slice(0, 2)}</span>}</div><div><b>公司 Logo</b><small>建议使用透明底 PNG，正方形或横版均可，最大 30MB。</small>{editable && <label className="settings-upload-button">{uploading === 'logo' ? '上传中…' : '上传或更换 Logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => upload(event.target.files?.[0], 'logo')} /></label>}{editable && settings.logoUrl && <button className="text-danger" onClick={() => setSettings(current => ({ ...current, logoUrl: '', logoThumbnailUrl: '' }))}>移除 Logo</button>}</div></div>
            <div className="brand-preview"><span>实时预览</span><article><div>{settings.logoThumbnailUrl || settings.logoUrl ? <img src={settings.logoThumbnailUrl || settings.logoUrl} alt="" /> : <i>{(settings.companyShortName || '知源').slice(0, 2)}</i>}<p><b>{settings.companyShortName || '知源'}</b><small>{settings.systemName || '知源 BPMS'}</small></p></div></article></div>
          </div>
          <div className="settings-form-grid brand-fields">{field('系统名称', 'systemName', '例如：知源 BPMS')}{field('单据页眉名称', 'documentHeader', '留空时使用公司全称')}<label className="settings-switch full"><input type="checkbox" checked={settings.showLogoInDocuments !== false} disabled={!editable} onChange={event => patch('showLogoInDocuments', event.target.checked)} /><i /><span><b>在打印单据中显示公司 Logo</b><small>适用于配货清单、成本核算单及后续报价文件。</small></span></label></div>
        </section>}

        {activeTab === 'service' && <section className="settings-section">
          <div className="settings-section-title"><div><p>AFTER-SALES CONTACT</p><h2>售后负责人信息</h2><span>集中维护对外服务联系人和服务时间。</span></div></div>
          <div className="service-layout"><div className="settings-form-grid">{field('负责人姓名', 'afterSalesName')}{field('职位', 'afterSalesTitle', '例如：售后经理')}{field('手机号', 'afterSalesPhone')}{field('微信号', 'afterSalesWechat')}{field('邮箱', 'afterSalesEmail', '', 'email')}{field('服务时间', 'serviceHours', '例如：周一至周六 08:30–18:00')}<label className="full"><span>售后说明</span><textarea value={settings.afterSalesNotes || ''} disabled={!editable} onChange={event => patch('afterSalesNotes', event.target.value)} placeholder="退换、补货、质量问题等服务说明" /></label></div><div className="service-qr"><b>售后微信二维码</b><div>{settings.afterSalesQrUrl ? <img src={settings.afterSalesQrUrl} alt="售后二维码" /> : <span>暂未上传</span>}</div>{editable && <label className="settings-upload-button">{uploading === 'qr' ? '上传中…' : '上传二维码'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => upload(event.target.files?.[0], 'qr')} /></label>}</div></div>
          <div className="settings-visibility"><label className="settings-switch"><input type="checkbox" checked={settings.showAfterSalesInMiniProgram !== false} disabled={!editable} onChange={event => patch('showAfterSalesInMiniProgram', event.target.checked)} /><i /><span><b>小程序展示</b><small>允许查询用户查看售后联系方式</small></span></label><label className="settings-switch"><input type="checkbox" checked={settings.showAfterSalesInDocuments !== false} disabled={!editable} onChange={event => patch('showAfterSalesInDocuments', event.target.checked)} /><i /><span><b>打印单据展示</b><small>在对外单据底部显示售后信息</small></span></label></div>
        </section>}

        {activeTab === 'security' && <section className="settings-section security-section">
          <div className="settings-section-title"><div><p>ACCOUNT SECURITY</p><h2>账户密码</h2><span>修改当前登录账户的密码，保存后需要重新登录。</span></div></div>
          <div className="account-summary"><span>{(user.displayName || user.username || '用').slice(0, 1)}</span><div><b>{user.displayName}</b><small>@{user.username} · {user.role === 'admin' ? '管理员' : '普通用户'}</small></div></div>
          <form className="password-form" onSubmit={changePassword}><label><span>当前密码</span><input type="password" autoComplete="current-password" value={password.currentPassword} onChange={event => setPassword(current => ({ ...current, currentPassword: event.target.value }))} required /></label><label><span>新密码</span><input type="password" autoComplete="new-password" minLength="10" value={password.newPassword} onChange={event => setPassword(current => ({ ...current, newPassword: event.target.value }))} required /><small>至少 10 位，建议包含字母、数字和符号。</small></label><label><span>确认新密码</span><input type="password" autoComplete="new-password" minLength="10" value={password.confirmPassword} onChange={event => setPassword(current => ({ ...current, confirmPassword: event.target.value }))} required /></label><button className="primary" disabled={busy}>修改密码</button></form>
          {user.role === 'admin' && userManagement && <div className="embedded-user-management"><div className="embedded-section-heading"><div><p>USERS & PERMISSIONS</p><h2>用户管理</h2><span>新增账号、调整角色、停用账号或重置用户密码。</span></div></div>{userManagement}</div>}
        </section>}

        {message && <p className={`settings-message ${message.includes('已') ? 'success' : ''}`}>{message}</p>}
        {activeTab !== 'security' && editable && <footer className="settings-actions"><span>修改会记录操作人和时间</span><button className="primary" onClick={save} disabled={busy}>{busy ? '正在保存…' : '保存设置'}</button></footer>}
      </div>
    </section>
  </>;
}
