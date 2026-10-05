import { useEffect, useMemo, useState } from 'react';
import { api } from './api-client.js';
import './process-archive.css';

const categories = ['裁剪', '车缝', '组装', '五金', '包装', '其他'];
const emptyProcess = () => ({ name: '', category: '车缝', default_duration_minutes: '', default_unit_price: '', notes: '' });
const money = value => `¥${Number(value || 0).toFixed(2)}`;

export default function WorkProcessLibrary() {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(emptyProcess());
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    const result = await api('/work-processes');
    setItems(Array.isArray(result) ? result : []);
  };

  useEffect(() => {
    let active = true;
    api('/work-processes')
      .then(result => active && setItems(Array.isArray(result) ? result : []))
      .catch(error => active && setMessage(error.message));
    return () => { active = false; };
  }, []);

  const visibleItems = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    return (items || []).filter(item => {
      const text = `${item.code || ''} ${item.name || ''} ${item.category || ''} ${item.notes || ''}`.toLowerCase();
      return (!category || item.category === category) && (!search || text.includes(search));
    });
  }, [items, keyword, category]);

  const save = async event => {
    event.preventDefault();
    try {
      setMessage('');
      const editing = Boolean(form.id);
      await api(editing ? `/work-processes/${form.id}` : '/work-processes', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(form),
      });
      setForm(emptyProcess());
      await load();
      setMessage(editing ? '标准工序已更新' : '标准工序已新增');
    } catch (error) {
      setMessage(error.message);
    }
  };

  if (!items) return <div className="loading">正在加载工序库…</div>;

  return <>
    <header>
      <div><p>STANDARD PROCESS / RAW MATERIAL LIBRARY</p><h1>工序库</h1></div>
      <span className="library-header-note">产品工序档案从这里调用标准工序</span>
    </header>
    <section className="process-library-layout">
      <form className="panel process-library-form" onSubmit={save}>
        <div className="section-title">
          <div><p>{form.id ? 'EDIT PROCESS' : 'NEW PROCESS'}</p><h2>{form.id ? '编辑标准工序' : '新增标准工序'}</h2></div>
          {form.id && <button type="button" onClick={() => setForm(emptyProcess())}>取消编辑</button>}
        </div>
        <label><span className="process-field-label">工序名称 <i>必填</i></span><input value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} placeholder="例如：车包口明线" required /></label>
        <label><span className="process-field-label">工序分类</span><select value={form.category} onChange={event => setForm(value => ({ ...value, category: event.target.value }))}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
        <div className="process-library-numbers">
          <label><span className="process-field-label">默认用时</span><span className="process-input-unit"><input type="number" min="0" step="0.01" value={form.default_duration_minutes} onChange={event => setForm(value => ({ ...value, default_duration_minutes: event.target.value }))} placeholder="0.00" /><i>分钟</i></span></label>
          <label><span className="process-field-label">默认工价</span><span className="process-input-unit"><input type="number" min="0" step="0.01" value={form.default_unit_price} onChange={event => setForm(value => ({ ...value, default_unit_price: event.target.value }))} placeholder="0.00" /><i>元</i></span></label>
        </div>
        <label><span className="process-field-label">默认备注 <em>选填</em></span><textarea value={form.notes || ''} onChange={event => setForm(value => ({ ...value, notes: event.target.value }))} placeholder="填写操作要求、质量标准或特殊说明" /></label>
        <div className="process-library-formula">默认值用于新增产品工序，产品档案中仍可单独调整用时和工价。</div>
        <button className="primary big">{form.id ? '保存标准工序' : '新增标准工序'}</button>
        {message && <p className="notice neutral">{message}</p>}
      </form>

      <section className="panel process-library-list">
        <div className="toolbar">
          <div className="archive-filters">
            <div className="search">⌕<input value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="搜索工序编号、名称或备注" /></div>
            <select value={category} onChange={event => setCategory(event.target.value)}><option value="">全部分类</option>{categories.map(item => <option key={item}>{item}</option>)}</select>
          </div>
          <span>{visibleItems.length} / {items.length} 道工序</span>
        </div>
        <table>
          <thead><tr><th>编号 / 工序</th><th>分类</th><th>默认用时</th><th>默认工价</th><th>默认备注</th><th>操作</th></tr></thead>
          <tbody>{visibleItems.map(item => <tr key={item.id}>
            <td><b>{item.name}</b><small>{item.code}</small></td>
            <td><span className="process-category-tag">{item.category}</span></td>
            <td>{Number(item.default_duration_minutes || 0).toFixed(2)} 分钟</td>
            <td><b>{money(item.default_unit_price)}</b></td>
            <td className="note-cell">{item.notes || '—'}</td>
            <td className="actions"><button onClick={() => setForm({ ...item })}>编辑</button></td>
          </tr>)}</tbody>
        </table>
        {!visibleItems.length && <div className="empty">没有找到符合条件的标准工序</div>}
      </section>
    </section>
  </>;
}
