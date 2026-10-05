import { Component, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import AIQuoteAssistant from "./SampleQuoteWorkspace.jsx";
import QuotationWorkspace from "./QuotationWorkspace.jsx";
import AgentWorkspace from "./AgentWorkspace.jsx";
import AgentSettings from "./AgentSettings.jsx";
import ProcessArchiveWorkspace from "./ProcessArchiveWorkspace.jsx";
import WorkProcessLibrary from "./WorkProcessLibrary.jsx";
import SystemSettings from "./SystemSettings.jsx";
import { api, clearAccessToken, setAccessToken } from "./api-client.js";
import "./styles.css";
import "./brass-sidebar.css";
import "./compact-mobile.css";

const formatDate = (value) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
const formatMoney = (value) => `¥${Number(value || 0).toFixed(2)}`;
const exportDeliveryOrderCsv = (order) => {
  const escape = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    [
      "清单编号",
      "产品货号",
      "产品名称",
      "订单颜色",
      "库别",
      "材料名称",
      "材料颜色",
      "规格",
      "配货数量",
      "单位",
      "单价",
      "材料成本",
      "选定下料方案",
      "裁剪方式",
    ],
    ...order.items.map((item) => [
      order.order_no,
      order.product_sku,
      order.product_name,
      item.source_plan_colors,
      item.library_type,
      item.material_name,
      item.material_color,
      item.material_specification,
      item.required_quantity,
      item.library_type === "五金配件库" ? item.unit : "m",
      item.unit_price,
      item.material_cost,
      item.cuttingPlans?.[0]?.name || "",
      item.cuttingPlans?.[0]?.cutting_mode || item.cutting_mode || "",
    ]),
  ];
  const blob = new Blob(
    [`\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${order.order_no}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
const emptyAccessory = () => ({
  material_id: "",
  color: "",
  quantity: "",
  notes: "",
});
const emptyProduct = {
  code: "自动生成",
  sku: "",
  name: "",
  category: "托特包",
  colors: [],
  brand: "",
  development_date: "",
  status: "销售中",
  warehouse_location: "",
  strap_info: "",
  process_notes: "",
  notes: "",
  accessories: [],
  parts: [],
};
const emptyMaterial = {
  name: "",
  category_name: "面布",
  specification: "",
  color: "",
  unit: "m",
  width_cm: "",
  weight_gsm: "",
  roll_length_cm: "",
  unit_price: "",
  supplier: "",
  image_url: "",
  notes: "",
};
const fabricCategories = [
  "面布",
  "里布",
  "夹层",
  "支撑板",
  "复合布",
  "其它",
  "布料",
];
const lengthCategories = ["长度材料", "织带", "绳子", "拉链"];
const materialLibraryType = (material) =>
  fabricCategories.includes(material?.category_name)
    ? "布料库"
    : lengthCategories.includes(material?.category_name)
      ? "长度材料库"
      : "五金配件库";
const libraryDisplayName = (libraryType) =>
  libraryType === "长度材料库"
    ? "线材库"
    : libraryType === "五金配件库"
      ? "配件库"
      : libraryType;
const emptyDeliveryRule = {
  material_id: "",
  library_type: "布料库",
  category: "面料",
  color_strategy: "follow",
  color: "",
  color_mappings: [],
  description: "",
  quantity_per_product: "",
  cutting_length_cm: "",
  unit: "m",
  calculation_method: "裁剪拉布",
  cutting_mode: "待确认",
  notes: "",
};

function ColorField({ value, onChange, label = "颜色", required = false }) {
  const { data: colors, reload } = useRequest("/meta/colors");
  const addColor = async () => {
    const name = window.prompt("请输入新颜色");
    if (!name?.trim()) return;
    const color = await api("/meta/colors", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    onChange(color.name);
    reload();
  };
  return (
    <label>
      {label}
      <span className="field-with-button">
        <SearchableSelect
          value={value || ""}
          onChange={(color) =>
            onChange(
              colors?.find((item) => String(item.id) === String(color))?.name ||
                color,
            )
          }
          placeholder="搜索并选择颜色"
          required={required}
          options={(colors || []).map((color) => ({
            value: color.name,
            label: color.name,
          }))}
        />
        <button type="button" onClick={addColor}>
          新增
        </button>
      </span>
    </label>
  );
}
function SearchableSelect({
  options = [],
  value,
  onChange,
  placeholder = "输入名称、编号或规格搜索",
  required = false,
  disabled = false,
  ariaLabel,
}) {
  const normalized = options.map((option) => ({
    value: String(option.value),
    label: String(option.label),
  }));
  const selectedLabel =
    normalized.find((option) => option.value === String(value || ""))?.label ||
    "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => setQuery(selectedLabel), [selectedLabel]);
  const keyword = query.trim().toLocaleLowerCase();
  const matches = (
    keyword
      ? normalized.filter((option) =>
          option.label.toLocaleLowerCase().includes(keyword),
        )
      : normalized
  ).slice(0, 30);
  const select = (option) => {
    setQuery(option.label);
    onChange(option.value);
    setOpen(false);
    setActiveIndex(-1);
  };
  const input = (event) => {
    const text = event.target.value;
    setQuery(text);
    setOpen(true);
    setActiveIndex(-1);
    if (!text.trim()) onChange("");
  };
  const blur = () =>
    setTimeout(() => {
      setOpen(false);
      if (!normalized.some((option) => option.label === query))
        setQuery(selectedLabel);
    }, 100);
  const keyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && matches[activeIndex]) {
      event.preventDefault();
      select(matches[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selectedLabel);
    }
  };
  return (
    <span className="searchable-select">
      <input
        value={query}
        onChange={input}
        onFocus={() => !disabled && setOpen(true)}
        onBlur={blur}
        onKeyDown={keyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel || placeholder}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && !disabled && (
        <span className="searchable-options" role="listbox">
          {matches.length ? (
            matches.map((option, index) => (
              <button
                type="button"
                role="option"
                aria-selected={
                  option.value === String(value) || index === activeIndex
                }
                className={index === activeIndex ? "active" : ""}
                key={option.value}
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(option);
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <i>没有匹配的内容</i>
          )}
        </span>
      )}
      <small>
        {disabled
          ? "该内容由关联档案自动维护"
          : "可输入关键词筛选，再从匹配项中选择"}
      </small>
    </span>
  );
}
function DeliveryRules() {
  const { data: products } = useRequest("/products");
  const { data: materials } = useRequest("/materials");
  const [productId, setProductId] = useState("");
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = () =>
    productId && api(`/products/${productId}/delivery-rules`).then(setRules);
  useEffect(() => {
    if (products?.[0] && !productId) setProductId(String(products[0].id));
  }, [products, productId]);
  useEffect(() => {
    load();
  }, [productId]);
  const save = async (event) => {
    event.preventDefault();
    const rule = editing;
    await api(
      rule.id
        ? `/delivery-rules/${rule.id}`
        : `/products/${productId}/delivery-rules`,
      { method: rule.id ? "PUT" : "POST", body: JSON.stringify(rule) },
    );
    setEditing(null);
    load();
  };
  const remove = async (rule) => {
    if (!window.confirm(`确认删除「${rule.material_name || "该规则"}」吗？`))
      return;
    await api(`/delivery-rules/${rule.id}`, { method: "DELETE" });
    load();
  };
  return (
    <>
      <Header
        title="配货档案"
        subtitle="DELIVERY RULES / MATERIAL & ACCESSORY"
        action={
          <button
            className="primary"
            onClick={() => setEditing({ ...emptyDeliveryRule })}
          >
            + 新增配货规则
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <label>
            产品
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              {products?.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <span>{rules.length} 条规则</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>分类</th>
              <th>材料 / 颜色</th>
              <th>单包参数</th>
              <th>裁剪 / 配货</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.category}</td>
                <td>
                  <b>{rule.material_name}</b>
                  <small>
                    {rule.color || "通用"} · {rule.description || "—"}
                  </small>
                </td>
                <td>
                  {rule.quantity_per_product || "—"} {rule.unit || ""}
                  <small>
                    {rule.cutting_length_cm
                      ? `${rule.cutting_length_cm}cm`
                      : "无长度参数"}
                  </small>
                </td>
                <td>
                  {rule.calculation_method}
                  <small>{rule.cutting_mode}</small>
                </td>
                <td className="actions">
                  <button onClick={() => setEditing(rule)}>编辑</button>
                  <button className="danger" onClick={() => remove(rule)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing && (
        <div className="modal-shade">
          <form className="modal material-form" onSubmit={save}>
            <div className="modal-head">
              <div>
                <p>DELIVERY RULE</p>
                <h2>{editing.id ? "编辑配货规则" : "新增配货规则"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(null)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                材料
                <select
                  value={editing.material_id}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      material_id: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">请选择材料</option>
                  {materials?.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name} · {material.color || "无颜色"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                分类
                <select
                  value={editing.category}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      category: event.target.value,
                      calculation_method:
                        event.target.value === "配件" ? "配件数量" : "裁剪拉布",
                    }))
                  }
                >
                  {["面料", "里布", "配件"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                材料颜色
                <input
                  value={editing.color || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      color: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                单包数量
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={editing.quantity_per_product || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      quantity_per_product: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                单包 / 拉布长度（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={editing.cutting_length_cm || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      cutting_length_cm: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                单位
                <input
                  value={editing.unit || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      unit: event.target.value,
                    }))
                  }
                  placeholder="m、根、个、对"
                />
              </label>
              <label>
                裁剪方式
                <select
                  value={editing.cutting_mode || "待确认"}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      cutting_mode: event.target.value,
                    }))
                  }
                >
                  {["刀模裁剪", "手工裁剪", "待确认"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                规格 / 说明
                <textarea
                  value={editing.description || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="primary">保存规则</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function Sidebar({ page, setPage, user, onLogout, open, onClose, systemSettings }) {
  const groups = [
    {
      label: "概览",
      children: [
        ["dashboard", "工作台概览"],
        ["agent", "AI Agent"],
        ["aiQuote", "AI 新款核价"],
        ["quotations", "报价单"],
      ],
    },
    {
      label: "档案部",
      children: [
        ["products", "产品档案"],
        ["customers", "客户档案"],
        ["parts", "裁片档案"],
        ["accessories", "配件档案"],
        ["deliveryRules", "配货档案"],
        ["processes", "工序工价档案"],
      ],
    },
    {
      label: "原料库",
      children: [
        ["fabrics", "布料库"],
        ["lengthMaterials", "线材库"],
        ["hardware", "配件库"],
        ["processLibrary", "工序库"],
        ["molds", "刀模库"],
        ["cuttingPlans", "下料库"],
      ],
    },
    {
      label: "配货清单",
      children: [
        ["bom", "BOM 配货计算"],
        ["productCost", "产品成本核算"],
        ["deliveryHistory", "配货清单历史"],
        ["deliveryCost", "配货成本核算"],
      ],
    },
    {
      label: "系统",
      children:
        user.role === "admin"
          ? [
              ["settings", "系统设置"],
              ["agentSettings", "Agent接入管理"],
              ["api", "小程序接口"],
            ]
          : [
              ["settings", "系统设置"],
              ["agentSettings", "Agent接入管理"],
              ["api", "小程序接口"],
            ],
    },
  ];
  return (
    <>
      <button
        className={`sidebar-backdrop ${open ? "show" : ""}`}
        aria-label="关闭导航"
        onClick={onClose}
      />
      <aside className={`site-sidebar ${open ? "open" : ""}`}>
        <div className="brand">
          <img src={systemSettings?.logoThumbnailUrl || systemSettings?.logoUrl || "/zhiyuan-mark.svg"} alt="" />
          <div className="brand-copy">
            <b>{systemSettings?.companyShortName || "知源"}</b>
            <small>{systemSettings?.systemName || "手袋 BOM 配货管理系统"}</small>
          </div>
          <button
            className="sidebar-close"
            type="button"
            aria-label="关闭导航"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <nav>
          {groups.map((group) => (
            <section className="nav-group" key={group.label}>
              <div className="nav-group-title">
                <span>{group.label}</span>
              </div>
              <div className="nav-subitems">
                {group.children.map(([key, label]) => (
                  <button
                    className={page === key ? "active" : ""}
                    onClick={() => {
                      setPage(key);
                      onClose();
                    }}
                    key={key}
                  >
                    <i aria-hidden="true" />
                    {label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </nav>
        <div className="sidebar-user">
          <span>
            <b>{user.displayName}</b>
            <small>{user.role === "admin" ? "管理员" : "普通用户"}</small>
          </span>
          <button type="button" onClick={onLogout}>
            退出
          </button>
        </div>
        <div className="sidebar-bottom">
          <span>ZHIYUAN SYSTEM</span>
          <small>V1.0 · 数字化工厂</small>
        </div>
      </aside>
    </>
  );
}
function Header({ title, subtitle, action }) {
  return (
    <header>
      <div>
        <p>{subtitle}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}

const appModuleGroups = {
  archivesHub: {
    eyebrow: "ARCHIVE CENTER",
    title: "档案中心",
    description: "集中维护产品、客户、工艺与生产资料。",
    items: [
      ["products", "产品档案", "货号、图片、颜色与基础资料", "产"],
      ["customers", "客户档案", "公司、联系人与报价偏好", "客"],
      ["parts", "裁片档案", "产品裁片与尺寸资料", "裁"],
      ["accessories", "配件档案", "产品关联配件资料", "配"],
      ["processes", "工序工价", "工序、用时与工价", "序"],
      ["deliveryRules", "配货档案", "生产配货计算规则", "档"],
      ["fabrics", "布料库", "面布、里布与复合材料", "布"],
      ["lengthMaterials", "线材库", "织带、绳子与拉链", "线"],
      ["hardware", "配件库", "五金与标牌配件", "件"],
      ["processLibrary", "工序库", "标准工序资料", "工"],
      ["molds", "刀模库", "刀模图片与关联裁片", "模"],
      ["cuttingPlans", "下料库", "下料方案与排版资料", "料"],
    ],
  },
  deliveryHub: {
    eyebrow: "DELIVERY WORKSPACE",
    title: "配货中心",
    description: "从 BOM 计算到成本与历史清单，一处完成。",
    items: [
      ["bom", "BOM 配货计算", "按产品颜色与数量生成清单", "算"],
      ["productCost", "产品成本核算", "核算单件产品完整成本", "本"],
      ["deliveryHistory", "配货清单历史", "查看已保存的生产清单", "单"],
      ["deliveryCost", "配货成本核算", "核对材料与配货成本", "价"],
    ],
  },
};

function AppModuleHub({ type, setPage }) {
  const group = appModuleGroups[type];
  return (
    <section className="app-module-hub">
      <div className="app-hub-intro">
        <p>{group.eyebrow}</p>
        <h1>{group.title}</h1>
        <span>{group.description}</span>
      </div>
      <div className="app-module-grid">
        {group.items.map(([page, title, description, icon]) => (
          <button type="button" key={page} onClick={() => setPage(page)}>
            <i>{icon}</i>
            <span><b>{title}</b><small>{description}</small></span>
            <strong>›</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

const bottomNavGroups = {
  dashboard: ["dashboard"],
  archivesHub: ["archivesHub", "products", "customers", "parts", "accessories", "processes", "deliveryRules", "fabrics", "lengthMaterials", "hardware", "processLibrary", "molds", "cuttingPlans"],
  aiQuote: ["aiQuote", "quotations"],
  deliveryHub: ["deliveryHub", "bom", "productCost", "deliveryHistory", "deliveryCost"],
  settings: ["settings", "agent", "agentSettings", "api"],
};

function AppBottomNav({ page, setPage }) {
  const items = [
    ["dashboard", "首页", "⌂"],
    ["archivesHub", "档案", "档"],
    ["aiQuote", "核价", "核"],
    ["deliveryHub", "配货", "算"],
    ["settings", "我的", "我"],
  ];
  return (
    <nav className="app-bottom-nav" aria-label="APP 主导航">
      {items.map(([key, label, icon]) => {
        const active = bottomNavGroups[key].includes(page);
        return <button type="button" className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setPage(key)} key={key}><i>{icon}</i><span>{label}</span></button>;
      })}
    </nav>
  );
}

const mobilePageParents = {
  products: ["archivesHub", "档案中心"], customers: ["archivesHub", "档案中心"],
  parts: ["archivesHub", "档案中心"], accessories: ["archivesHub", "档案中心"],
  processes: ["archivesHub", "档案中心"], deliveryRules: ["archivesHub", "档案中心"],
  fabrics: ["archivesHub", "档案中心"], lengthMaterials: ["archivesHub", "档案中心"],
  hardware: ["archivesHub", "档案中心"], processLibrary: ["archivesHub", "档案中心"],
  molds: ["archivesHub", "档案中心"], cuttingPlans: ["archivesHub", "档案中心"],
  quotations: ["aiQuote", "核价中心"],
  bom: ["deliveryHub", "配货中心"], productCost: ["deliveryHub", "配货中心"],
  deliveryHistory: ["deliveryHub", "配货中心"], deliveryCost: ["deliveryHub", "配货中心"],
  agent: ["settings", "我的"], agentSettings: ["settings", "我的"], api: ["settings", "我的"],
};

function MobilePageBack({ page, setPage }) {
  const parent = mobilePageParents[page];
  if (!parent) return null;
  return (
    <button className="mobile-page-back" type="button" onClick={() => setPage(parent[0])}>
      <i aria-hidden="true">‹</i>
      <span>返回{parent[1]}</span>
    </button>
  );
}

function ModalDismissBehavior() {
  useEffect(() => {
    const dismissFromBackdrop = (event) => {
      const backdrop = event.target;
      if (!(backdrop instanceof HTMLElement) || !backdrop.classList.contains("modal-shade")) return;
      const closeButton = backdrop.querySelector(
        '[aria-label*="关闭"], .modal-head > button:last-child, .modal-head .maintenance-actions > button:last-child',
      );
      if (closeButton instanceof HTMLButtonElement) closeButton.click();
    };
    document.addEventListener("click", dismissFromBackdrop);
    return () => document.removeEventListener("click", dismissFromBackdrop);
  }, []);
  return null;
}
function archiveState(mode, product) {
  const count =
    mode === "parts"
      ? product.part_count
      : mode === "accessories"
        ? product.accessory_count
        : product.rule_count;
  if (!Number(count)) return "empty";
  const incomplete =
    mode === "parts"
      ? product.part_incomplete_count
      : mode === "accessories"
        ? product.accessory_incomplete_count
        : Number(product.rule_incomplete_count) +
          (Number(product.rule_fabric_count) ? 0 : 1);
  return Number(incomplete) ? "incomplete" : "complete";
}
function ArchiveState({ value, count = 0 }) {
  const labels = {
    complete: "资料完整",
    incomplete: `${count} 项待完善`,
    empty: "暂无数据",
  };
  return (
    <span className={`archive-state archive-state-${value}`}>
      {labels[value]}
    </span>
  );
}
function ArchiveSummaryCells({ mode, product, onOpenPlans, onOpenHistory }) {
  const state = archiveState(mode, product);
  if (mode === "parts")
    return (
      <>
        <td>
          <b>{product.part_count} 个裁片</b>
          <small>{product.part_material_count} 种布料主体</small>
        </td>
        <td>
          <b>{product.part_mold_count} 个刀模裁剪</b>
          <small>{product.part_hand_count} 个手工裁剪</small>
        </td>
        <td>
          <ArchiveState value={state} count={product.part_incomplete_count} />
          <small>
            {product.part_mold_count
              ? `已关联 ${product.part_mold_count} 个刀模`
              : "尚未关联刀模"}
          </small>
        </td>
      </>
    );
  if (mode === "accessories")
    return (
      <>
        <td>
          <b>{product.accessory_count} 种配件</b>
          <small>产品单包用量档案</small>
        </td>
        <td>
          <b>{product.accessory_length_count} 种线材</b>
          <small>{product.accessory_hardware_count} 种五金配件</small>
        </td>
        <td>
          <b>
            {product.accessory_linked_count} / {product.accessory_count}{" "}
            已关联库
          </b>
          <small>
            {Number(product.accessory_count) -
              Number(product.accessory_linked_count)}{" "}
            项待关联
          </small>
        </td>
        <td>
          <ArchiveState
            value={state}
            count={product.accessory_incomplete_count}
          />
        </td>
      </>
    );
  const ready =
    Number(product.rule_fabric_count) > 0 &&
    !Number(product.rule_incomplete_count);
  return (
    <>
      <td>
        <b>
          布料 {product.rule_fabric_count} · 线材 {product.rule_length_count}
        </b>
        <small>配件 {product.rule_hardware_count} 条</small>
      </td>
      <td>
        <b>{product.rule_mapped_color_count} 条特殊颜色</b>
        <small>其余规则按默认颜色策略</small>
      </td>
      <td>
        <button
          type="button"
          className="archive-plan-link"
          onClick={(event) => {
            event.stopPropagation();
            onOpenPlans(product);
          }}
        >
          <b>{product.cutting_plan_count} 套下料方案</b>
          <small>{product.default_cutting_plan_count} 套为单张 10 包</small>
          <span>查看方案列表 →</span>
        </button>
      </td>
      <td>
        <button
          type="button"
          className="archive-plan-link archive-history-link"
          onClick={(event) => {
            event.stopPropagation();
            onOpenHistory(product);
          }}
        >
          <b>{product.delivery_order_count} 张历史清单</b>
          <small>显示最近 5 张</small>
          <span>查看配货历史 →</span>
        </button>
      </td>
      <td>
        <ArchiveState
          value={state}
          count={
            Number(product.rule_incomplete_count) +
            (Number(product.rule_fabric_count) ? 0 : 1)
          }
        />
        <small>{ready ? "可以生成 BOM 配货清单" : "完善后可生成 BOM"}</small>
      </td>
    </>
  );
}
function ProductCuttingPlanList({ product, onClose }) {
  const { data, error, reload } = useRequest(
    `/cutting-plans?product_id=${product.id}`,
  );
  return (
    <div className="modal-shade">
      <section className="modal detail archive-plan-modal">
        <div className="modal-head">
          <div>
            <p>CUTTING PLAN LIST</p>
            <h2>
              {product.sku} · {product.name}
            </h2>
            <small>该产品配货档案关联的全部下料方案</small>
          </div>
          <button type="button" aria-label="关闭下料方案列表" onClick={onClose}>
            ×
          </button>
        </div>
        {error ? (
          <ErrorState error={error} retry={reload} />
        ) : !data ? (
          <LoadingState text="正在加载下料方案…" />
        ) : data.length ? (
          <table>
            <thead>
              <tr>
                <th>参考图 / 方案</th>
                <th>关联布料</th>
                <th>单张包数</th>
                <th>拉布长度</th>
                <th>裁剪方式 / 刀模</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {data.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <span className="material-with-image">
                      <ImageThumb
                        src={plan.image_url}
                        alt={plan.name}
                        fallback="料"
                      />
                      <span>
                        <b>{plan.name}</b>
                        <small>{plan.product_sku}</small>
                      </span>
                    </span>
                  </td>
                  <td>
                    <b>{plan.material_name || "未关联布料"}</b>
                    <small>{plan.material_specification || "—"}</small>
                  </td>
                  <td>{plan.pieces_per_lay || "—"} 包</td>
                  <td>{plan.cutting_length_cm || "—"} cm</td>
                  <td>
                    <b>{plan.cutting_mode || "待确认"}</b>
                    <small>
                      {plan.molds?.length
                        ? plan.molds.map((mold) => mold.code).join("、")
                        : "无关联刀模"}
                    </small>
                  </td>
                  <td className="note-cell">{plan.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty archive-empty">该产品暂未建立下料方案</div>
        )}
      </section>
    </div>
  );
}
function ProductDeliveryHistoryList({ product, onClose }) {
  const { data, error, reload } = useRequest(
    `/delivery-orders?product_id=${product.id}&limit=5`,
  );
  const [selected, setSelected] = useState(null);
  const open = async (id) => {
    try {
      setSelected(await api(`/delivery-orders/${id}`));
    } catch (reason) {
      window.alert(reason.message);
    }
  };
  return (
    <>
      <div className="modal-shade">
        <section className="modal detail archive-plan-modal archive-history-modal">
          <div className="modal-head">
            <div>
              <p>RECENT DELIVERY HISTORY</p>
              <h2>
                {product.sku} · {product.name}
              </h2>
              <small>最近 5 张历史配货清单</small>
            </div>
            <button
              type="button"
              aria-label="关闭配货历史列表"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {error ? (
            <ErrorState error={error} retry={reload} />
          ) : !data ? (
            <LoadingState text="正在加载历史配货清单…" />
          ) : data.length ? (
            <table>
              <thead>
                <tr>
                  <th>清单编号</th>
                  <th>生产数量</th>
                  <th>材料项</th>
                  <th>状态</th>
                  <th>总成本</th>
                  <th>保存时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.map((order) => (
                  <tr
                    className="clickable-history-row"
                    key={order.id}
                    onClick={() => open(order.id)}
                  >
                    <td>
                      <b>{order.order_no}</b>
                    </td>
                    <td>{order.production_quantity} 件</td>
                    <td>{order.item_count} 项</td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>{formatMoney(order.total_cost)}</td>
                    <td>{formatDate(order.created_at)}</td>
                    <td className="actions">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          open(order.id);
                        }}
                      >
                        查看清单 →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty archive-empty">
              该产品尚未保存历史配货清单
            </div>
          )}
        </section>
      </div>
      {selected && (
        <DeliveryOrderDetail
          order={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
function ProductMaintenanceList({ mode, title, subtitle, onOpen }) {
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("all");
  const [planProduct, setPlanProduct] = useState(null);
  const [historyProduct, setHistoryProduct] = useState(null);
  const { data, error, reload } = useRequest(
    `/products/maintenance-summary?mode=${mode}&keyword=${encodeURIComponent(keyword)}`,
  );
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  const visible =
    filter === "all"
      ? data
      : data.filter((product) => archiveState(mode, product) === filter);
  const headers =
    mode === "parts"
      ? ["产品 / 货号", "裁片 / 布料", "裁剪方式", "资料状态", "操作"]
      : mode === "accessories"
        ? [
            "产品 / 货号",
            "配件总览",
            "线材 / 五金",
            "材料库关联",
            "资料状态",
            "操作",
          ]
        : [
            "产品 / 货号",
            "三类配货规则",
            "颜色策略",
            "下料方案",
            "历史清单",
            "BOM 状态",
            "操作",
          ];
  const placeholder =
    mode === "parts"
      ? "搜索货号、产品名称、裁片或布料"
      : mode === "accessories"
        ? "搜索货号、产品名称、配件或材料"
        : "搜索货号、产品名称、配货材料或说明";
  return (
    <>
      <Header title={title} subtitle={subtitle} />
      <section className="panel archive-index">
        <div className="toolbar archive-toolbar">
          <div className="archive-filters">
            <div className="search">
              ⌕
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={placeholder}
              />
            </div>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              aria-label="筛选资料完整度"
            >
              <option value="all">全部资料</option>
              <option value="complete">资料完整</option>
              <option value="incomplete">待完善</option>
              <option value="empty">无数据</option>
            </select>
          </div>
          <span>
            {visible.length} / {data.length} 款产品
          </span>
        </div>
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const open = () => onOpen(product);
              return (
                <tr
                  className="archive-row"
                  key={product.id}
                  role="link"
                  tabIndex="0"
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open();
                    }
                  }}
                >
                  <td>
                    <span className="archive-product-cell">
                      <ImageThumb
                        src={product.image_url}
                        alt={product.name}
                        fallback="包"
                      />
                      <span>
                        <b>{product.sku}</b>
                        <small>{product.name}</small>
                      </span>
                    </span>
                  </td>
                  <ArchiveSummaryCells
                    mode={mode}
                    product={product}
                    onOpenPlans={setPlanProduct}
                    onOpenHistory={setHistoryProduct}
                  />
                  <td className="actions">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                    >
                      进入详情 →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visible.length === 0 && (
          <div className="empty archive-empty">没有找到符合条件的档案</div>
        )}
      </section>
      {planProduct && (
        <ProductCuttingPlanList
          product={planProduct}
          onClose={() => setPlanProduct(null)}
        />
      )}{" "}
      {historyProduct && (
        <ProductDeliveryHistoryList
          product={historyProduct}
          onClose={() => setHistoryProduct(null)}
        />
      )}
    </>
  );
}

const maintenanceConfigs = {
  parts: {
    title: "裁片档案",
    subtitle: "CUTTING PARTS / PRODUCT INDEX",
    path: "parts",
    addLabel: "新增裁片",
  },
  accessories: {
    title: "配件档案",
    subtitle: "ACCESSORIES / PRODUCT INDEX",
    path: "accessories",
    addLabel: "新增配件",
  },
  rules: {
    title: "配货档案",
    subtitle: "DELIVERY RULES / PRODUCT INDEX",
    path: "delivery-rules",
    addLabel: "新增规则",
  },
};

function MaintenanceWorkspace({ mode }) {
  const config = maintenanceConfigs[mode];
  const { data: materials } = useRequest("/materials");
  const { data: molds } = useRequest("/molds");
  const [product, setProduct] = useState(null);
  const [rows, setRows] = useState([]);
  const [paperImage, setPaperImage] = useState(null);
  const [paperPreview, setPaperPreview] = useState(false);
  const [paperUploading, setPaperUploading] = useState(false);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async (selected = product) => {
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const rowsRequest = api(`/products/${selected.id}/${config.path}`);
      if (mode === "parts") {
        const [nextRows, detail] = await Promise.all([
          rowsRequest,
          api(`/products/${selected.id}/detail`),
        ]);
        const paperImages = (detail.images || []).filter(
          (image) => image.type === "裁片",
        );
        setRows(nextRows);
        setPaperImage(paperImages[paperImages.length - 1] || null);
        setPaperPreview(false);
      } else {
        setRows(await rowsRequest);
        setPaperImage(null);
        setPaperPreview(false);
      }
    } catch (reason) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (product) load(product);
  }, [product?.id, mode]);
  const reorder = async (nextRows) => {
    const previous = rows;
    setRows(nextRows);
    setError("");
    try {
      await api(`/products/${product.id}/${config.path}/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids: nextRows.map((item) => item.id) }),
      });
    } catch (reason) {
      setRows(previous);
      setError(reason.message);
    }
  };
  const uploadPaperImage = async (file) => {
    if (!file || mode !== "parts" || !product) return;
    setPaperUploading(true);
    setError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const image = await api(`/products/${product.id}/images`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, type: "裁片" }),
      });
      setPaperImage(image);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setPaperUploading(false);
    }
  };
  if (!product)
    return (
      <ProductMaintenanceList
        mode={mode}
        title={config.title}
        subtitle={config.subtitle}
        onOpen={setProduct}
      />
    );
  const materialRows = materials || [];
  const moldRows =
    mode === "parts" && product
      ? (molds || []).filter(
          (item) => Number(item.product_id) === Number(product.id),
        )
      : molds || [];
  const productColors = String(product.colors_text || "")
    .split("、")
    .map((item) => item.trim())
    .filter(Boolean);
  const choices =
    mode === "parts"
      ? materialRows.filter((item) =>
          fabricCategories.includes(item.category_name),
        )
      : mode === "accessories"
        ? materialRows.filter(
            (item) => !fabricCategories.includes(item.category_name),
          )
        : materialRows;
  const empty =
    mode === "parts"
      ? {
          material_id: "",
          mold_id: "",
          name: "",
          color: "",
          max_length_cm: "",
          max_width_cm: "",
          quantity_per_product: 1,
          image_url: "",
          notes: "",
        }
      : mode === "accessories"
        ? { material_id: "", color: "", quantity: "", notes: "" }
        : { ...emptyDeliveryRule };
  const save = async (event) => {
    event.preventDefault();
    setError("");
    try {
      const path =
        mode === "parts"
          ? editing.id
            ? `/cutting-parts/${editing.id}`
            : `/products/${product.id}/parts`
          : mode === "accessories"
            ? editing.id
              ? `/product-accessories/${editing.id}`
              : `/products/${product.id}/accessories`
            : editing.id
              ? `/delivery-rules/${editing.id}`
              : `/products/${product.id}/delivery-rules`;
      await api(path, {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(editing),
      });
      setEditing(null);
      await load();
    } catch (reason) {
      setError(reason.message);
    }
  };
  const remove = async (item) => {
    if (!window.confirm("确认删除这条资料吗？")) return;
    const path =
      mode === "parts"
        ? `/cutting-parts/${item.id}`
        : mode === "accessories"
          ? `/product-accessories/${item.id}`
          : `/delivery-rules/${item.id}`;
    try {
      await api(path, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason.message);
    }
  };
  return (
    <>
      <Header
        title={config.title}
        subtitle={`${product.sku} · ${product.name}`}
        action={
          <span className="maintenance-actions">
            <button onClick={() => setProduct(null)}>← 返回产品列表</button>
            <button
              className="primary"
              onClick={() => setEditing({ ...empty })}
            >
              + {config.addLabel}
            </button>
          </span>
        }
      />
      {error && <div className="error">{error}</div>}
      <section className="panel">
        <div className="maintenance-product">
          <div className="maintenance-product-main">
            <div className="maintenance-product-title">
              <small>当前产品</small>
              <b>
                {product.sku} · {product.name}
              </b>
            </div>
            {mode === "parts" && (
              <div className="paper-description-preview">
                <small>纸格描述图</small>
                <ImageUploadDropZone
                  src={paperImage?.thumbnail_url || paperImage?.url}
                  alt={`${product.name}纸格描述图`}
                  emptyText="待上传"
                  actionText={paperImage ? "更换图片" : "+ 上传图片"}
                  uploading={paperUploading}
                  onPreview={
                    paperImage?.url ? () => setPaperPreview(true) : undefined
                  }
                  onFile={uploadPaperImage}
                />
              </div>
            )}
          </div>
          <span>
            {product.category || "未分类"}　
            {product.colors_text || "未设置颜色"}　
            <Status value={product.status} />
          </span>
        </div>
        {loading ? (
          <LoadingState text="正在加载维护资料…" />
        ) : (
          <>
            <MaintenanceCompletenessNotice mode={mode} rows={rows} />
            <MaintenanceTable
              mode={mode}
              rows={rows}
              onEdit={setEditing}
              onRemove={remove}
              onReorder={reorder}
            />
          </>
        )}
      </section>
      {paperPreview &&
        paperImage?.url &&
        createPortal(
          <div className="image-lightbox" onClick={() => setPaperPreview(false)}>
            <button
              type="button"
              aria-label="关闭纸格描述大图"
              onClick={() => setPaperPreview(false)}
            >
              ×
            </button>
            <img
              src={paperImage.url}
              alt={`${product.name}纸格描述大图`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
      {editing && (
        <MaintenanceForm
          mode={mode}
          value={editing}
          setValue={setEditing}
          materials={choices}
          molds={moldRows}
          productColors={productColors}
          onSubmit={save}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function LegacyMaintenanceTable({ mode, rows, onEdit, onRemove }) {
  if (rows.length === 0)
    return <div className="empty">该产品暂无资料，点击右上角新增</div>;
  return null;
}
function ResponsiveTableLabels() {
  useEffect(() => {
    const enhance = () =>
      document.querySelectorAll("table").forEach((table) => {
        const headers = [
          ...table.querySelectorAll("thead tr:first-child th"),
        ].map((cell) => cell.textContent.trim());
        if (!headers.length) return;
        table.classList.add("mobile-card-table");
        table
          .querySelectorAll("tbody tr")
          .forEach((row) =>
            [...row.children].forEach((cell, index) =>
              cell.setAttribute("data-label", headers[index] || "资料"),
            ),
          );
      });
    enhance();
    const observer = new MutationObserver(enhance);
    observer.observe(document.getElementById("root"), {
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
  return null;
}
function ImageThumb({ src, alt, fallback = "图" }) {
  return src ? (
    <img className="data-thumb" src={src} alt={alt} />
  ) : (
    <i className="data-thumb-fallback">{fallback}</i>
  );
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}
function ImageUploadDropZone({
  src,
  alt,
  emptyText = "暂无图片",
  actionText = "+ 上传图片",
  uploading = false,
  onPreview,
  onFile,
}) {
  const [dragging, setDragging] = useState(false);
  const disabled = uploading;
  const chooseFile = (file) => {
    setDragging(false);
    if (!disabled) onFile?.(file);
  };
  const handleDragOver = (event) => {
    event.preventDefault();
    if (disabled) return;
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    chooseFile(event.dataTransfer.files?.[0]);
  };
  return (
    <span
      className={`image-upload-field${dragging ? " is-dragging" : ""}${disabled ? " is-disabled" : ""}`}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      title="拖入图片或点击上传"
    >
      {src ? (
        onPreview ? (
          <button
            type="button"
            className="image-upload-preview-button"
            onClick={(event) => {
              event.stopPropagation();
              onPreview();
            }}
            title="点击查看大图"
          >
            <img src={src} alt={alt} />
          </button>
        ) : (
          <img src={src} alt={alt} />
        )
      ) : (
        <i>{emptyText}</i>
      )}
      <span>
        {uploading ? "上传中…" : actionText}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            chooseFile(event.target.files?.[0]);
            event.target.value = "";
          }}
          disabled={disabled}
        />
      </span>
    </span>
  );
}
const reorderByIds = (items, fromId, toId) => {
  const fromIndex = items.findIndex((item) => String(item.id) === String(fromId));
  const toIndex = items.findIndex((item) => String(item.id) === String(toId));
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};
const isInteractiveDragTarget = (target) =>
  target?.closest?.(
    "button,a,input,select,textarea,label,[data-no-sort-drag='true']",
  );
function useLongPressSortable(items, onReorder, { disabled = false } = {}) {
  const stateRef = useRef({
    timer: null,
    activeId: null,
    overId: null,
    armed: false,
  });
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);
  const clearTimer = () => {
    if (stateRef.current.timer) window.clearTimeout(stateRef.current.timer);
    stateRef.current.timer = null;
  };
  const reset = () => {
    clearTimer();
    stateRef.current.activeId = null;
    stateRef.current.overId = null;
    stateRef.current.armed = false;
    setActiveId(null);
    setOverId(null);
  };
  useEffect(() => () => clearTimer(), []);
  const idAtPoint = (event) =>
    document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest?.("[data-sort-id]")?.dataset.sortId;
  const itemProps = (id, className = "") => {
    const idText = String(id);
    const classes = [
      className,
      "sortable-item",
      activeId === idText ? "is-sorting" : "",
      overId === idText && activeId !== idText ? "is-sort-target" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      className: classes,
      "data-sort-id": idText,
      onPointerDown(event) {
        if (disabled || isInteractiveDragTarget(event.target)) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const currentTarget = event.currentTarget;
        const pointerId = event.pointerId;
        stateRef.current.activeId = idText;
        stateRef.current.overId = idText;
        clearTimer();
        stateRef.current.timer = window.setTimeout(() => {
          stateRef.current.armed = true;
          setActiveId(idText);
          setOverId(idText);
          currentTarget.setPointerCapture?.(pointerId);
        }, 380);
      },
      onPointerMove(event) {
        if (!stateRef.current.armed) return;
        event.preventDefault();
        const targetId = idAtPoint(event);
        if (targetId && targetId !== stateRef.current.overId) {
          stateRef.current.overId = targetId;
          setOverId(targetId);
        }
      },
      onPointerUp(event) {
        const wasArmed = stateRef.current.armed;
        const fromId = stateRef.current.activeId;
        const targetId = stateRef.current.overId || idAtPoint(event);
        if (wasArmed && fromId && targetId && fromId !== targetId) {
          const next = reorderByIds(items, fromId, targetId);
          onReorder?.(next);
        }
        reset();
      },
      onPointerCancel: reset,
    };
  };
  return { itemProps, activeId };
}
function CuttingPlanThumbs({ plans = [] }) {
  return plans.length ? (
    <span className="reference-thumbs">
      {plans.map((plan) => (
        <span
          key={plan.id}
          title={`${plan.name} · 单张${plan.pieces_per_lay}包 · ${plan.cutting_length_cm}cm`}
        >
          <ImageThumb
            src={plan.image_thumbnail_url || plan.image_url}
            alt={plan.name}
            fallback="料"
          />
          <small>{plan.name}</small>
        </span>
      ))}
    </span>
  ) : (
    <small>暂无下料参考</small>
  );
}
function CuttingPlanChoice({ plans = [], selectedId: controlledId, onSelect }) {
  const [selectedId, setSelectedId] = useState(plans[0]?.id || "");
  const [preview, setPreview] = useState(false);
  const activeId = controlledId ?? selectedId;
  useEffect(() => {
    if (
      controlledId == null &&
      !plans.some((plan) => String(plan.id) === String(selectedId))
    )
      setSelectedId(plans[0]?.id || "");
  }, [plans, selectedId, controlledId]);
  const selected =
    plans.find((plan) => String(plan.id) === String(activeId)) || plans[0];
  if (!selected) return <span className="muted">未关联下料参考</span>;
  const choose = (value) => {
    setSelectedId(value);
    onSelect?.(value);
  };
  return (
    <span className="cutting-choice">
      {plans.length > 1 && (
        <select
          value={selected.id}
          onChange={(event) => choose(event.target.value)}
          aria-label="选择下料参考"
        >
          {plans.map((plan) => (
            <option value={plan.id} key={plan.id}>
              {plan.name}
            </option>
          ))}
        </select>
      )}
      <span className="cutting-choice-detail">
        <button
          type="button"
          className="plan-preview-button"
          onClick={() => selected.image_url && setPreview(true)}
          disabled={!selected.image_url}
          title={selected.image_url ? "点击放大下料参考图" : "暂无下料参考图"}
        >
          <ImageThumb
            src={selected.image_thumbnail_url || selected.image_url}
            alt={selected.name}
            fallback="料"
          />
        </button>
        <span>
          <b>{selected.cutting_mode}</b>
          <small>{selected.name}</small>
          {selected.cutting_mode === "刀模裁剪" && (
            <small>
              {selected.molds?.length
                ? selected.molds.map((mold) => mold.code).join("、")
                : "未关联刀模"}
            </small>
          )}
        </span>
      </span>
      {preview &&
        createPortal(
          <div className="image-lightbox" onClick={() => setPreview(false)}>
            <button
              type="button"
              aria-label="关闭大图"
              onClick={() => setPreview(false)}
            >
              ×
            </button>
            <img
              src={selected.image_url}
              alt={`${selected.name} 下料参考大图`}
              onClick={(event) => event.stopPropagation()}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
function maintenanceIssues(mode, item) {
  const issues = [];
  if (mode === "parts") {
    if (!item.material_id) issues.push("未关联布料");
    if (!Number(item.max_length_cm)) issues.push("未填写长度");
    if (!Number(item.max_width_cm)) issues.push("未填写宽度");
    if (!Number(item.quantity_per_product)) issues.push("未填写片数");
  } else if (mode === "accessories") {
    if (!item.material_id) issues.push("未关联线材库或配件库");
    if (!Number(item.quantity)) issues.push("未填写单包数量");
  } else {
    if (!item.material_id) issues.push("未关联原料库");
    if (!Number(item.quantity_per_product))
      issues.push(
        item.library_type === "布料库" ? "未填写单张包数" : "未填写单包数量",
      );
    if (item.library_type !== "五金配件库" && !Number(item.cutting_length_cm))
      issues.push(
        item.library_type === "布料库" ? "未填写拉布长度" : "未填写单包长度",
      );
    if (
      item.library_type === "布料库" &&
      (!item.cutting_mode || item.cutting_mode === "待确认")
    )
      issues.push("裁剪方式待确认");
  }
  return issues;
}
function MaintenanceCompletenessNotice({ mode, rows }) {
  const entries = rows
    .map((item) => ({ item, issues: maintenanceIssues(mode, item) }))
    .filter((entry) => entry.issues.length);
  const missingFabric =
    mode === "rules" && !rows.some((item) => item.library_type === "布料库");
  if (!entries.length && !missingFabric) return null;
  return (
    <section className="maintenance-warning">
      <div>
        <b>以下项目需要完善</b>
        <small>黄色行已同步标记，点击该行右侧“编辑”补充资料。</small>
      </div>
      <ul>
        {missingFabric && (
          <li>
            <b>产品级：</b>尚未建立布料库配货规则
          </li>
        )}
        {entries.map(({ item, issues }) => (
          <li key={item.id}>
            <b>{item.name || item.material_name || `资料 ${item.id}`}：</b>
            {issues.join("、")}
          </li>
        ))}
      </ul>
    </section>
  );
}
function MaintenanceTable({ mode, rows, onEdit, onRemove, onReorder }) {
  const sortable = useLongPressSortable(rows, onReorder);
  if (rows.length === 0)
    return <div className="empty">该产品暂无资料，点击右上角新增</div>;
  const actions = (item) => {
    const linked =
      mode === "rules" && item.source_type && item.source_type !== "manual";
    return (
      <td className="actions">
        <button onClick={() => onEdit(item)}>编辑</button>
        {linked ? (
          <small>来源档案自动维护</small>
        ) : (
          <button className="danger" onClick={() => onRemove(item)}>
            删除
          </button>
        )}
      </td>
    );
  };
  if (mode === "parts")
    return (
      <table>
        <thead>
          <tr>
            <th>排序</th>
            <th>裁片</th>
            <th>布料主体</th>
            <th>尺寸 / 片数</th>
            <th>刀模 / 方式</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const issues = maintenanceIssues(mode, item);
            return (
              <tr
                key={item.id}
                {...sortable.itemProps(
                  item.id,
                  issues.length ? "maintenance-incomplete-row" : "",
                )}
              >
                <td className="sort-cell">
                  <span className="sort-drag-handle">按住拖动</span>
                </td>
                <td>
                  <span className="part-with-image">
                    <ImageThumb
                      src={item.image_url}
                      alt={item.name}
                      fallback="裁"
                    />
                    <span>
                      <b>{item.name}</b>
                      <small>{item.code}</small>
                      {issues.length ? (
                        <small className="maintenance-missing">
                          待完善：{issues.join("、")}
                        </small>
                      ) : null}
                    </span>
                  </span>
                </td>
                <td>{item.material_name || "—"}</td>
                <td>
                  {item.max_length_cm || "—"} × {item.max_width_cm || "—"} cm
                  <small>{item.quantity_per_product || "—"} 片</small>
                </td>
                <td>
                  {item.mold_code ? (
                    <span className="mold-thumb">
                      {item.mold_image_url ? (
                        <img src={item.mold_image_url} alt="刀模缩略图" />
                      ) : (
                        <i>刀</i>
                      )}
                      <span>
                        <b>{item.mold_code}</b>
                        <small>{item.mold_name || "已关联刀模"}</small>
                      </span>
                    </span>
                  ) : (
                    "手工裁剪"
                  )}
                </td>
                <td className="note-cell">{item.notes || "—"}</td>
                {actions(item)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  if (mode === "accessories")
    return (
      <table>
        <thead>
          <tr>
            <th>排序</th>
            <th>物品名称</th>
            <th>材质 / 分类</th>
            <th>单独颜色</th>
            <th>规格</th>
            <th>数量</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const issues = maintenanceIssues(mode, item);
            return (
              <tr
                key={item.id}
                {...sortable.itemProps(
                  item.id,
                  issues.length ? "maintenance-incomplete-row" : "",
                )}
              >
                <td className="sort-cell">
                  <span className="sort-drag-handle">按住拖动</span>
                </td>
                <td>
                  <b>{item.name || "—"}</b>
                  {issues.length ? (
                    <small className="maintenance-missing">
                      待完善：{issues.join("、")}
                    </small>
                  ) : null}
                </td>
                <td>
                  {item.material_id ? (
                    item.material || "已关联材料"
                  ) : (
                    <span className="status status-待确认">待关联材料库</span>
                  )}
                </td>
                <td>{item.color || "未选择"}</td>
                <td>{item.specification || "—"}</td>
                <td className="required">
                  {item.quantity ?? "—"} {item.unit || ""}
                </td>
                <td className="note-cell">{item.notes || "—"}</td>
                {actions(item)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  return (
    <table>
      <thead>
        <tr>
          <th>排序</th>
          <th>来源档案 / 库</th>
          <th>材料主体</th>
          <th>颜色策略</th>
          <th>配货参数</th>
          <th>计算逻辑</th>
          <th>下料参考</th>
          <th>规格 / 方式</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((item) => {
          const type = item.library_type || materialLibraryType(item);
          const issues = maintenanceIssues(mode, item);
          const role =
            type === "布料库"
              ? item.category === "里布"
                ? "里布"
                : "面布"
              : item.material_category || item.category;
          const source =
            item.source_type === "cutting_parts"
              ? `裁片档案：${(item.linked_parts || []).map((part) => part.name).join("、") || "待关联"}`
              : item.source_type === "product_accessory"
                ? `配件档案：${item.source_accessory?.name || "待关联"}`
                : "手动建立";
          const parameter =
            type === "布料库"
              ? `单张 ${item.quantity_per_product || "待完善"} 包 · 拉布 ${item.cutting_length_cm || "待完善"} cm`
              : type === "长度材料库"
                ? `单包 ${item.quantity_per_product || "待完善"} ${item.unit || "根"} · 每${item.unit || "根"} ${item.cutting_length_cm || "待完善"} cm`
                : `单包 ${item.quantity_per_product || "待完善"} ${item.unit || "个"}`;
          const logic =
            type === "布料库"
              ? "层数 × 拉布长度"
              : type === "长度材料库"
                ? "数量 × 单包长度"
                : "数量直接累计";
          const strategy =
            item.color_strategy || (item.color ? "fixed" : "follow");
          const color =
            strategy === "follow"
              ? "跟随产品颜色"
              : strategy === "fixed"
                ? `固定：${item.color || "未设置"}`
                : "特殊对应";
          const mappingText = (item.color_mappings || [])
            .map(
              (mapping) => `${mapping.product_color}→${mapping.material_color}`,
            )
            .join("；");
          return (
            <tr
              key={item.id}
              {...sortable.itemProps(
                item.id,
                issues.length ? "maintenance-incomplete-row" : "",
              )}
            >
              <td className="sort-cell">
                <span className="sort-drag-handle">按住拖动</span>
              </td>
              <td>
                <span className={`library-badge library-${type}`}>
                  {libraryDisplayName(type)}
                </span>
                <small>{role}</small>
                <small className="source-link-label">{source}</small>
                {issues.length ? (
                  <small className="maintenance-missing">
                    待完善：{issues.join("、")}
                  </small>
                ) : null}
              </td>
              <td>
                <span className="material-with-image">
                  <ImageThumb
                    src={item.material_image_url}
                    alt={item.material_name}
                    fallback="材"
                  />
                  <b>{item.material_name}</b>
                </span>
              </td>
              <td>
                <b>{color}</b>
                {strategy === "mapped" && (
                  <small>{mappingText || "未设置对应"}；其他颜色跟随产品</small>
                )}
              </td>
              <td>{parameter}</td>
              <td>{logic}</td>
              <td>
                {type === "布料库" ? (
                  <CuttingPlanThumbs plans={item.cutting_plans} />
                ) : (
                  <small>无需下料图</small>
                )}
              </td>
              <td>
                {item.material_specification || item.description || "—"}
                <small>
                  {type === "布料库"
                    ? item.cutting_mode
                    : item.description || "—"}
                </small>
              </td>
              {actions(item)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function LegacyMaintenanceForm({
  mode,
  value,
  setValue,
  materials,
  molds,
  onSubmit,
  onClose,
}) {
  const set = (field, fieldValue) =>
    setValue((current) => ({ ...current, [field]: fieldValue }));
  const ruleType =
    value.library_type ||
    materialLibraryType(
      materials.find((item) => String(item.id) === String(value.material_id)),
    ) ||
    "布料库";
  const ruleMaterials =
    mode === "rules"
      ? materials.filter((item) => materialLibraryType(item) === ruleType)
      : materials;
  const changeRuleType = (libraryType) =>
    setValue((current) => ({
      ...current,
      library_type: libraryType,
      material_id: "",
      color: libraryType === "布料库" ? "" : current.color,
      category: libraryType === "布料库" ? "面料" : "配件",
      calculation_method: libraryType === "布料库" ? "裁剪拉布" : "配件数量",
      unit:
        libraryType === "布料库"
          ? "m"
          : libraryType === "长度材料库"
            ? "根"
            : "个",
      cutting_length_cm:
        libraryType === "五金配件库" ? "" : current.cutting_length_cm,
    }));
  const selectMaterial = (materialId) => {
    const selected = materials.find(
      (item) => String(item.id) === String(materialId),
    );
    setValue((current) => ({
      ...current,
      material_id: materialId,
      color: current.color || selected?.color || "",
      unit: ruleType === "布料库" ? "m" : current.unit || selected?.unit || "",
    }));
  };
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={onSubmit}>
        <div className="modal-head">
          <div>
            <p>PRODUCT MAINTENANCE</p>
            <h2>{value.id ? "编辑资料" : "新增资料"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="form-grid">
          {mode === "rules" && (
            <label className="full">
              配货来源库
              <select
                value={ruleType}
                onChange={(event) => changeRuleType(event.target.value)}
              >
                {["布料库", "长度材料库", "五金配件库"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <small className="field-help">
                {ruleType === "布料库"
                  ? "按单张包数和拉布长度计算层数、总米数"
                  : ruleType === "长度材料库"
                    ? "按单包长度和数量计算总根数、总米数、总卷数"
                    : "按单包数量计算五金配件总数"}
              </small>
            </label>
          )}
          <label className="full">
            调用库内材料
            <select
              value={value.material_id || ""}
              onChange={(event) =>
                mode === "rules"
                  ? selectMaterial(event.target.value)
                  : set("material_id", event.target.value)
              }
              required
            >
              <option value="">
                请选择{mode === "rules" ? ruleType : "库内内容"}
              </option>
              {ruleMaterials.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.color || "无颜色"} ·{" "}
                  {item.specification || "无规格"}
                  {ruleType === "长度材料库" && item.roll_length_cm
                    ? ` · 每卷${item.roll_length_cm}cm`
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {mode === "parts" && (
            <>
              <label>
                裁片名称
                <input
                  value={value.name || ""}
                  onChange={(event) => set("name", event.target.value)}
                  required
                />
              </label>
              <label>
                片数
                <input
                  type="number"
                  min="1"
                  value={value.quantity_per_product || ""}
                  onChange={(event) =>
                    set("quantity_per_product", event.target.value)
                  }
                  required
                />
              </label>
              <label>
                最大长度（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.max_length_cm || ""}
                  onChange={(event) => set("max_length_cm", event.target.value)}
                />
              </label>
              <label>
                最大宽度（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.max_width_cm || ""}
                  onChange={(event) => set("max_width_cm", event.target.value)}
                />
              </label>
              <label>
                关联刀模
                <select
                  value={value.mold_id || ""}
                  onChange={(event) => set("mold_id", event.target.value)}
                >
                  <option value="">手工裁剪</option>
                  {molds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          {mode === "accessories" && (
            <label>
              数量
              <input
                type="number"
                min="0"
                step="any"
                value={value.quantity || ""}
                onChange={(event) => set("quantity", event.target.value)}
                required
              />
            </label>
          )}
          {mode === "rules" && (
            <>
              <label>
                颜色
                <input
                  value={value.color || ""}
                  onChange={(event) => set("color", event.target.value)}
                />
              </label>
              <label>
                {ruleType === "布料库" ? "单张包数" : "单包数量"}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.quantity_per_product || ""}
                  onChange={(event) =>
                    set("quantity_per_product", event.target.value)
                  }
                  required
                />
              </label>
              {ruleType !== "五金配件库" && (
                <label>
                  {ruleType === "布料库" ? "拉布长度（cm）" : "单包长度（cm）"}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={value.cutting_length_cm || ""}
                    onChange={(event) =>
                      set("cutting_length_cm", event.target.value)
                    }
                    required
                  />
                </label>
              )}
              {ruleType !== "布料库" && (
                <label>
                  数量单位
                  <input
                    value={value.unit || ""}
                    onChange={(event) => set("unit", event.target.value)}
                    placeholder={
                      ruleType === "长度材料库" ? "根、条" : "个、对、套"
                    }
                  />
                </label>
              )}
              {ruleType === "布料库" && (
                <label>
                  裁剪方式
                  <select
                    value={value.cutting_mode || "待确认"}
                    onChange={(event) =>
                      set("cutting_mode", event.target.value)
                    }
                  >
                    {["刀模裁剪", "手工裁剪", "待确认"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="full">
                规格 / 颜色对应说明
                <textarea
                  value={value.description || ""}
                  onChange={(event) => set("description", event.target.value)}
                  placeholder="例如：黑色配白色织带；或填写特殊规格"
                />
              </label>
            </>
          )}{" "}
          {mode !== "rules" && (
            <label className="full">
              备注说明
              <textarea
                value={value.notes || ""}
                onChange={(event) => set("notes", event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存资料</button>
        </div>
      </form>
    </div>
  );
}
function MaintenanceForm({
  mode,
  value,
  setValue,
  materials,
  molds,
  productColors = [],
  onSubmit,
  onClose,
}) {
  const set = (field, fieldValue) =>
    setValue((current) => ({ ...current, [field]: fieldValue }));
  const [partImageUploading, setPartImageUploading] = useState(false);
  const uploadPartImage = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      window.alert("裁片图片不能超过 30MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setPartImageUploading(true);
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        set("image_url", image.url);
      } catch (reason) {
        window.alert(reason.message);
      } finally {
        setPartImageUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const ruleType = value.library_type || "布料库";
  const availableMaterials =
    mode === "rules"
      ? materials.filter((item) => materialLibraryType(item) === ruleType)
      : materials;
  const fabricRole = value.category === "里布" ? "里布" : "面料";
  const colorStrategy =
    value.color_strategy || (value.color ? "fixed" : "follow");
  const mappings = value.color_mappings || [];
  const linkedSource =
    mode === "rules" && value.source_type && value.source_type !== "manual";
  const accessorySource = value.source_type === "product_accessory";
  const sourceSummary =
    value.source_type === "cutting_parts"
      ? `裁片档案：${(value.linked_parts || []).map((part) => `${part.name}（${part.quantity_per_product}片）`).join("、")}`
      : accessorySource
        ? `配件档案：${value.source_accessory?.name || "已关联配件"} · ${value.source_accessory?.quantity ?? "—"} ${value.source_accessory?.unit || ""}`
        : "";
  const changeRuleType = (libraryType) =>
    setValue((current) => ({
      ...current,
      library_type: libraryType,
      material_id: "",
      color_strategy: "follow",
      color: "",
      color_mappings: [],
      category: libraryType === "布料库" ? "面料" : "配件",
      calculation_method: libraryType === "布料库" ? "裁剪拉布" : "配件数量",
      unit:
        libraryType === "布料库"
          ? "m"
          : libraryType === "长度材料库"
            ? "根"
            : "个",
      cutting_length_cm:
        libraryType === "五金配件库" ? "" : current.cutting_length_cm,
    }));
  const changeFabricRole = (category) =>
    setValue((current) => ({
      ...current,
      category,
      color_strategy: category === "里布" ? "fixed" : "follow",
      color: "",
      color_mappings: [],
    }));
  const changeColorStrategy = (strategy) =>
    setValue((current) => ({
      ...current,
      color_strategy: strategy,
      color: strategy === "fixed" ? current.color : "",
      color_mappings: strategy === "mapped" ? current.color_mappings || [] : [],
    }));
  const selectMaterial = (materialId) =>
    setValue((current) => ({ ...current, material_id: materialId }));
  const addMapping = () =>
    setValue((current) => ({
      ...current,
      color_mappings: [
        ...(current.color_mappings || []),
        {
          product_color:
            productColors.find(
              (color) =>
                !(current.color_mappings || []).some(
                  (mapping) => mapping.product_color === color,
                ),
            ) || "",
          material_color: "",
        },
      ],
    }));
  const updateMapping = (index, field, fieldValue) =>
    setValue((current) => ({
      ...current,
      color_mappings: (current.color_mappings || []).map(
        (mapping, itemIndex) =>
          itemIndex === index ? { ...mapping, [field]: fieldValue } : mapping,
      ),
    }));
  const removeMapping = (index) =>
    setValue((current) => ({
      ...current,
      color_mappings: (current.color_mappings || []).filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={onSubmit}>
        <div className="modal-head">
          <div>
            <p>PRODUCT MAINTENANCE</p>
            <h2>{value.id ? "编辑资料" : "新增资料"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="form-grid">
          {linkedSource && (
            <div className="full source-link-card">
              <b>数据来源已关联</b>
              <span>{sourceSummary}</span>
              <small>
                材料与基础数量由来源档案同步，配货档案只维护计算参数和颜色策略。
              </small>
            </div>
          )}
          {mode === "rules" && (
            <label className="full">
              配货来源库
              <select
                value={ruleType}
                onChange={(event) => changeRuleType(event.target.value)}
                disabled={linkedSource}
              >
                {["布料库", "长度材料库", "五金配件库"].map((item) => (
                  <option value={item} key={item}>
                    {libraryDisplayName(item)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="full">
            调用库内材料
            <SearchableSelect
              value={value.material_id || ""}
              onChange={selectMaterial}
              required
              disabled={linkedSource}
              ariaLabel="搜索并选择库内材料"
              placeholder={`搜索${mode === "rules" ? libraryDisplayName(ruleType) : "库内内容"}的名称、分类或规格`}
              options={availableMaterials.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.category_name || "未分类"} · ${item.specification || "无规格"}${ruleType === "长度材料库" && item.roll_length_cm ? ` · 每卷${item.roll_length_cm}cm` : ""}`,
              }))}
            />
          </label>
          {mode === "rules" && ruleType === "布料库" && (
            <label>
              布料用途
              <select
                value={fabricRole}
                onChange={(event) => changeFabricRole(event.target.value)}
              >
                <option value="面料">面布</option>
                <option value="里布">里布</option>
              </select>
            </label>
          )}
          {mode === "rules" && (
            <label>
              颜色策略
              <select
                value={colorStrategy}
                onChange={(event) => changeColorStrategy(event.target.value)}
              >
                <option value="follow">跟随产品颜色（默认）</option>
                <option value="fixed">固定颜色</option>
                <option value="mapped">特殊颜色对应</option>
              </select>
            </label>
          )}
          {mode === "rules" && colorStrategy === "fixed" && (
            <ColorField
              value={value.color}
              onChange={(color) => set("color", color)}
              label="固定材料颜色"
              required
            />
          )}
          {mode === "rules" && colorStrategy === "mapped" && (
            <section className="full color-mapping-editor">
              <div className="block-title">
                <div>
                  <b>特殊颜色对应</b>
                  <small>
                    产品颜色来自产品档案；没有单独设置的颜色继续跟随产品颜色。
                  </small>
                </div>
                <button type="button" onClick={addMapping}>
                  + 增加对应
                </button>
              </div>
              {!productColors.length && (
                <div className="notice">请先在产品档案中增加产品颜色。</div>
              )}
              {mappings.map((mapping, index) => (
                <div className="color-mapping-row" key={index}>
                  <label>
                    产品颜色
                    <select
                      value={mapping.product_color || ""}
                      onChange={(event) =>
                        updateMapping(
                          index,
                          "product_color",
                          event.target.value,
                        )
                      }
                      required
                    >
                      <option value="">请选择产品颜色</option>
                      {productColors.map((color) => (
                        <option key={color} value={color}>
                          {color}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>对应</span>
                  <ColorField
                    value={mapping.material_color}
                    onChange={(color) =>
                      updateMapping(index, "material_color", color)
                    }
                    label="材料颜色"
                    required
                  />
                  <button
                    type="button"
                    className="danger"
                    onClick={() => removeMapping(index)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </section>
          )}
          {mode === "accessories" && (
            <ColorField
              value={value.color}
              onChange={(color) => set("color", color)}
              label="单独选择颜色"
            />
          )}
          {mode === "parts" && (
            <>
              <label>
                裁片名称
                <input
                  value={value.name || ""}
                  onChange={(event) => set("name", event.target.value)}
                  required
                />
              </label>
              <label>
                片数
                <input
                  type="number"
                  min="1"
                  value={value.quantity_per_product || ""}
                  onChange={(event) =>
                    set("quantity_per_product", event.target.value)
                  }
                  required
                />
              </label>
              <label>
                最大长度（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.max_length_cm || ""}
                  onChange={(event) => set("max_length_cm", event.target.value)}
                />
              </label>
              <label>
                最大宽度（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.max_width_cm || ""}
                  onChange={(event) => set("max_width_cm", event.target.value)}
                />
              </label>
              <label>
                关联刀模
                <SearchableSelect
                  value={value.mold_id || ""}
                  onChange={(moldId) => set("mold_id", moldId)}
                  placeholder="搜索刀模编号或名称；留空为手工裁剪"
                  ariaLabel="搜索并选择关联刀模"
                  options={molds.map((item) => ({
                    value: item.id,
                    label: `${item.code} · ${item.name}`,
                  }))}
                />
              </label>
              <label className="full">
                裁片图片
                <ImageUploadDropZone
                  src={value.image_url}
                  alt="裁片图片预览"
                  actionText="+ 上传裁片图片"
                  uploading={partImageUploading}
                  onFile={uploadPartImage}
                />
              </label>
            </>
          )}
          {mode === "parts" && (
            <>
              <label>
                排料旋转
                <select
                  value={value.rotation_mode || "free"}
                  onChange={(event) => set("rotation_mode", event.target.value)}
                >
                  <option value="free">允许旋转 90°</option>
                  <option value="fixed">不可旋转</option>
                  <option value="same_direction">必须同向</option>
                </select>
              </label>
              <label>
                特殊间隙（cm）
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.gap_cm ?? ""}
                  onChange={(event) => set("gap_cm", event.target.value)}
                  placeholder="留空使用默认间隙"
                />
              </label>
            </>
          )}
          {mode === "accessories" && (
            <label>
              数量
              <input
                type="number"
                min="0"
                step="any"
                value={value.quantity || ""}
                onChange={(event) => set("quantity", event.target.value)}
                required
              />
            </label>
          )}
          {mode === "rules" && (
            <>
              <label>
                {ruleType === "布料库" ? "单张包数" : "单包数量"}
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={value.quantity_per_product || ""}
                  onChange={(event) =>
                    set("quantity_per_product", event.target.value)
                  }
                  required
                  disabled={accessorySource}
                />
                {accessorySource && <small>来自配件档案</small>}
              </label>
              {ruleType !== "五金配件库" && (
                <label>
                  {ruleType === "布料库" ? "拉布长度（cm）" : "单包长度（cm）"}
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={value.cutting_length_cm || ""}
                    onChange={(event) =>
                      set("cutting_length_cm", event.target.value)
                    }
                    required
                  />
                </label>
              )}
              {ruleType !== "布料库" && (
                <label>
                  数量单位
                  <input
                    value={value.unit || ""}
                    onChange={(event) => set("unit", event.target.value)}
                    placeholder={
                      ruleType === "长度材料库" ? "根、条" : "个、对、套"
                    }
                    disabled={accessorySource}
                  />
                </label>
              )}
              {ruleType === "布料库" && (
                <label>
                  裁剪方式
                  <select
                    value={value.cutting_mode || "待确认"}
                    onChange={(event) =>
                      set("cutting_mode", event.target.value)
                    }
                  >
                    {["刀模裁剪", "手工裁剪", "待确认"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="full">
                规格 / 说明（不参与颜色判断）
                <textarea
                  value={value.description || ""}
                  onChange={(event) => set("description", event.target.value)}
                />
              </label>
            </>
          )}
          {mode !== "rules" && (
            <label className="full">
              备注说明
              <textarea
                value={value.notes || ""}
                onChange={(event) => set("notes", event.target.value)}
              />
            </label>
          )}
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={partImageUploading}>
            保存资料
          </button>
        </div>
      </form>
    </div>
  );
}
function Status({ value }) {
  const label = value === "开发中" ? "销售中" : value;
  return <span className={`status status-${value}`}>{label}</span>;
}
function LoadingState({ text = "正在加载数据…" }) {
  return <div className="loading">{text}</div>;
}
function ErrorState({ error, retry }) {
  return (
    <section className="panel request-error">
      <h2>暂时无法加载此页面</h2>
      <p>{error.message || "网络连接或接口暂时不可用，请稍后重试。"}</p>
      <button className="primary" onClick={retry}>
        重新加载
      </button>
    </section>
  );
}
class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidUpdate(previousProps) {
    if (previousProps.page !== this.props.page && this.state.error)
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <ErrorState
        error={this.state.error}
        retry={() => this.setState({ error: null })}
      />
    ) : (
      this.props.children
    );
  }
}
function useRequest(path) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: true,
    key: 0,
  });
  useEffect(() => {
    let active = true;
    setState((value) => ({ ...value, error: null, loading: true }));
    api(path)
      .then(
        (data) =>
          active && setState((value) => ({ ...value, data, loading: false })),
      )
      .catch(
        (error) =>
          active && setState((value) => ({ ...value, error, loading: false })),
      );
    return () => {
      active = false;
    };
  }, [path, state.key]);
  return {
    ...state,
    reload: () => setState((value) => ({ ...value, key: value.key + 1 })),
  };
}

function Dashboard({ setPage }) {
  const { data, error, reload } = useRequest("/dashboard");
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState text="正在加载业务工作台…" />;
  const counts = data.counts || {};
  const materialAlerts = data.materialAlerts || {};
  const archiveHealth = Array.isArray(data.archiveHealth)
    ? data.archiveHealth
    : [];
  const todoProducts = Array.isArray(data.todoProducts)
    ? data.todoProducts.map((item) => ({
        ...item,
        missing: Array.isArray(item.missing) ? item.missing : [],
      }))
    : [];
  const recentOrders = Array.isArray(data.recentOrders)
    ? data.recentOrders
    : [];
  const stats = [
    {
      label: "待完善产品档案",
      value: counts.incompleteProducts || 0,
      hint: `共 ${counts.products || 0} 款产品`,
      page: "products",
      tone: "green",
    },
    {
      label: "待确认原料价格",
      value: materialAlerts.missingPrice || 0,
      hint: `原料库共 ${counts.materials || 0} 项`,
      page: "fabrics",
      tone: "blue",
    },
    {
      label: "历史配货清单",
      value: counts.deliveryOrders || 0,
      hint: "查看生产配货记录",
      page: "deliveryHistory",
      tone: "orange",
    },
    {
      label: "待完成成本核算",
      value: counts.pendingCosts || 0,
      hint: "尚未形成完整成本",
      page: "deliveryCost",
      tone: "purple",
    },
  ];
  const shortcuts = [
    ["新建产品档案", "建立货号、颜色与图片", "products", "+"],
    ["维护配货档案", "设置布料、线材和配件规则", "deliveryRules", "档"],
    ["BOM 配货计算", "按颜色与数量生成配货清单", "bom", "算"],
    ["新增原料资料", "维护原料图片、规格与价格", "fabrics", "库"],
  ];
  const missingPage = (item) =>
    item.product_missing
      ? "products"
      : item.part_missing
        ? "parts"
        : item.accessory_missing
          ? "accessories"
          : "deliveryRules";
  return (
    <>
      <Header
        title="生产资料工作台"
        subtitle="总览 / BUSINESS WORKSPACE"
        action={
          <button className="primary" onClick={() => setPage("bom")}>
            开始 BOM 配货 →
          </button>
        }
      />
      <section className="dashboard-stats">
        {stats.map((item, index) => (
          <button
            type="button"
            className={`dashboard-stat tone-${item.tone}`}
            key={item.label}
            onClick={() => setPage(item.page)}
          >
            <span>0{index + 1}</span>
            <strong>{item.value}</strong>
            <b>{item.label}</b>
            <small>{item.hint}</small>
            <i>查看处理 →</i>
          </button>
        ))}
      </section>
      <section className="dashboard-quick-strip">
        <div>
          <p>QUICK START</p>
          <b>常用业务入口</b>
        </div>
        {shortcuts.map(([label, description, page, icon]) => (
          <button type="button" key={label} onClick={() => setPage(page)}>
            <i>{icon}</i>
            <span>
              <b>{label}</b>
              <small>{description}</small>
            </span>
            <strong>→</strong>
          </button>
        ))}
      </section>
      <section className="dashboard-grid">
        <div className="dashboard-main-column">
          <section className="panel dashboard-todos">
            <div className="section-title">
              <div>
                <p>PRIORITY TASKS</p>
                <h2>优先完善的产品</h2>
              </div>
              <button onClick={() => setPage("products")}>查看全部</button>
            </div>
            {todoProducts.length ? (
              <div className="todo-list">
                {todoProducts.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() => setPage(missingPage(item))}
                  >
                    <span className="todo-product">
                      <b>{item.sku}</b>
                      <small>{item.name}</small>
                    </span>
                    <span className="todo-tags">
                      {item.missing.map((label) => (
                        <i key={label}>{label}</i>
                      ))}
                    </span>
                    <time>{formatDate(item.updated_at)}</time>
                    <strong>立即完善 →</strong>
                  </button>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty">暂无需要优先处理的产品</div>
            )}
          </section>
        </div>
        <div className="dashboard-side-column">
          <section className="panel dashboard-health">
            <div className="section-title">
              <div>
                <p>ARCHIVE COMPLETENESS</p>
                <h2>档案完整度</h2>
              </div>
              <small>影响 BOM 计算</small>
            </div>
            <div className="health-list">
              {archiveHealth.map((item) => {
                const percent = item.total
                  ? Math.round((item.complete / item.total) * 100)
                  : 100;
                return (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => setPage(item.page)}
                  >
                    <span>
                      <b>{item.label}</b>
                      <small>
                        {item.pending
                          ? `${item.pending} 款待完善`
                          : "已全部完善"}
                      </small>
                    </span>
                    <i>
                      <em style={{ width: `${percent}%` }} />
                    </i>
                    <strong>{percent}%</strong>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="panel material-alerts">
            <div className="section-title">
              <div>
                <p>MATERIAL ALERTS</p>
                <h2>原料库提醒</h2>
              </div>
              <button onClick={() => setPage("fabrics")}>进入原料库</button>
            </div>
            <div>
              {[
                ["缺少价格", materialAlerts.missingPrice],
                ["缺少图片", materialAlerts.missingImage],
                ["缺少供应商", materialAlerts.missingSupplier],
                ["尚未被调用", materialAlerts.unusedMaterials],
              ].map(([label, value]) => (
                <button
                  type="button"
                  key={label}
                  onClick={() => setPage("fabrics")}
                >
                  <span>{label}</span>
                  <b>{value || 0} 项</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
      <section className="panel dashboard-orders">
        <div className="section-title">
          <div>
            <p>RECENT DELIVERY LISTS</p>
            <h2>最近配货清单</h2>
          </div>
          <button onClick={() => setPage("deliveryHistory")}>查看全部</button>
        </div>
        {recentOrders.length ? (
          <table>
            <thead>
              <tr>
                <th>清单编号</th>
                <th>产品</th>
                <th>生产数量</th>
                <th>状态</th>
                <th>成本</th>
                <th>保存时间</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((order) => (
                <tr
                  className="dashboard-order-row"
                  key={order.id}
                  onClick={() => setPage("deliveryHistory")}
                >
                  <td>
                    <b>{order.order_no}</b>
                  </td>
                  <td>
                    {order.product_sku}
                    <small>{order.product_name}</small>
                  </td>
                  <td>{order.production_quantity} 件</td>
                  <td>
                    <Status value={order.status} />
                  </td>
                  <td>
                    {Number(order.total_cost) > 0 ? (
                      formatMoney(order.total_cost)
                    ) : (
                      <span className="pending-cost">待核算</span>
                    )}
                  </td>
                  <td>{formatDate(order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dashboard-empty">
            还没有配货清单，可以从 BOM 配货计算开始。
          </div>
        )}
      </section>
    </>
  );
}

function ColorPicker({ values, onChange, options, onCreate }) {
  const [open, setOpen] = useState(false);
  const toggle = (name) =>
    onChange(
      values.includes(name)
        ? values.filter((value) => value !== name)
        : [...values, name],
    );
  const add = async () => {
    const name = window.prompt("请输入新颜色，例如：咖啡色、橄榄绿");
    if (!name?.trim()) return;
    await onCreate(name.trim());
    if (!values.includes(name.trim())) onChange([...values, name.trim()]);
  };
  return (
    <>
      <button
        type="button"
        className="color-select-trigger"
        onClick={() => setOpen(true)}
      >
        {values.length
          ? values.map((value) => <i key={value}>{value}</i>)
          : "选择产品颜色"}
        <span>选择</span>
      </button>
      {open && (
        <div className="color-dialog-shade">
          <section className="color-dialog">
            <div className="modal-head">
              <div>
                <p>PRODUCT COLORS</p>
                <h2>选择产品颜色</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)}>
                ×
              </button>
            </div>
            <div className="chips">
              {options.map((color) => (
                <button
                  type="button"
                  onClick={() => toggle(color.name)}
                  className={
                    values.includes(color.name) ? "chip selected" : "chip"
                  }
                  key={color.id}
                >
                  {color.name}
                </button>
              ))}
              <button type="button" className="chip color-add" onClick={add}>
                ＋
              </button>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="primary"
                onClick={() => setOpen(false)}
              >
                完成选择
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function LegacyAccessoriesEditor({ value, onChange }) {
  const { data } = useRequest("/materials");
  const materials = data || [];
  const update = (index, field, fieldValue) =>
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: fieldValue } : item,
      ),
    );
  const selectable = materials.filter(
    (item) =>
      !["面布", "里布", "夹层", "支撑板", "复合布", "其它", "布料"].includes(
        item.category_name,
      ),
  );
  return (
    <section className="editor-block">
      <div className="block-title">
        <div>
          <b>配件资料</b>
          <small>
            仅可从长度材料库、五金配件库选择；未选择库内内容的行不会保存。
          </small>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, emptyAccessory()])}
        >
          + 添加配件
        </button>
      </div>
      <div className="accessory-editor">
        <div className="accessory-head">
          <span>库内名称</span>
          <span>材质</span>
          <span>规格</span>
          <span>数量</span>
          <span>备注说明</span>
          <span />
        </div>
        {value.map((item, index) => {
          const selected = materials.find(
            (material) => String(material.id) === String(item.material_id),
          );
          return (
            <div className="accessory-row" key={index}>
              <select
                value={item.material_id || ""}
                onChange={(event) =>
                  update(index, "material_id", event.target.value)
                }
              >
                <option value="">请选择库内配件</option>
                {selectable.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {material.color || "无颜色"}
                  </option>
                ))}
              </select>
              <span>{selected?.category_name || "—"}</span>
              <span>{selected?.specification || "—"}</span>
              <input
                style={{ minWidth: 120 }}
                type="number"
                min="0"
                step="any"
                value={item.quantity || ""}
                onChange={(event) =>
                  update(index, "quantity", event.target.value)
                }
                placeholder="数量"
              />
              <input
                value={item.notes || ""}
                onChange={(event) => update(index, "notes", event.target.value)}
                placeholder="备注说明"
              />
              <button
                type="button"
                className="danger"
                onClick={() =>
                  onChange(value.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                移除
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function ProductImageManager({ productId }) {
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const load = () =>
    api(`/products/${productId}/detail`).then((detail) =>
      setImages(detail.images),
    );
  useEffect(() => {
    load();
  }, [productId]);
  const uploadFile = async (file) => {
    setDragging(false);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return window.alert("请选择 JPG、PNG 或 WebP 图片");
    if (file.size > 20 * 1024 * 1024)
      return window.alert("图片不能超过 20MB，请压缩后重新上传");
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api(`/products/${productId}/images`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, type: "正面" }),
      });
      await load();
    } catch (error) {
      window.alert(error.message);
    } finally {
      setUploading(false);
    }
  };
  const upload = async (event) => {
    await uploadFile(event.target.files?.[0]);
    event.target.value = "";
  };
  const handleDragOver = (event) => {
    event.preventDefault();
    if (uploading) return;
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    if (!uploading) uploadFile(event.dataTransfer.files?.[0]);
  };
  const reorderImages = async (nextImages) => {
    const previous = images;
    setImages(nextImages);
    try {
      await api(`/products/${productId}/images/reorder`, {
        method: "POST",
        body: JSON.stringify({ ids: nextImages.map((image) => image.id) }),
      });
    } catch (error) {
      setImages(previous);
      window.alert(error.message);
    }
  };
  const sortable = useLongPressSortable(images, reorderImages);
  const remove = async (image) => {
    if (!window.confirm("确认删除这张产品图片吗？")) return;
    await api(`/products/${productId}/images/${image.id}`, {
      method: "DELETE",
    });
    setImages((items) => items.filter((item) => item.id !== image.id));
  };
  return (
    <section
      className={`editor-block image-editor${dragging ? " is-dragging" : ""}`}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      title="拖入图片或点击上传"
    >
      <div className="block-title">
        <div>
          <b>产品图片</b>
          <small>支持 JPG、PNG、WebP，单张不超过 20MB；上传后立即显示</small>
        </div>
        <label className="upload-button">
          {uploading ? "上传中…" : "+ 添加图片"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={upload}
            disabled={uploading}
          />
        </label>
      </div>
      <div className="edit-image-grid">
        {images.length ? (
          images.map((image) => (
            <article key={image.id} {...sortable.itemProps(image.id)}>
              <span className="sort-drag-handle image-sort-handle">
                按住拖动
              </span>
              <img src={image.url} alt="产品图片" />
              <button
                type="button"
                className="danger"
                onClick={() => remove(image)}
              >
                删除
              </button>
            </article>
          ))
        ) : (
          <p className="muted">暂未上传图片。</p>
        )}
      </div>
    </section>
  );
}
function ProductForm({ product, onClose, onSave }) {
  const initial = product
    ? {
        ...product,
        status: product.status === "开发中" ? "销售中" : product.status,
        colors:
          product.colors ||
          product.colors_text?.split("、").filter(Boolean) ||
          [],
      }
    : emptyProduct;
  const [form, setForm] = useState(initial);
  const [meta, setMeta] = useState({ categories: [], colors: [] });
  const [error, setError] = useState("");
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    Promise.all([
      api("/meta/product-categories"),
      api("/meta/colors"),
      product
        ? api(`/products/${product.id}/detail`)
        : api("/products/next-code"),
    ])
      .then(([categories, colors, detail]) => {
        setMeta({
          categories: categories.filter(
            (item) =>
              !["?", "？", "??", "？？", "???", "？？？"].includes(
                item.name.trim(),
              ),
          ),
          colors,
        });
        if (product)
          setForm((current) => ({
            ...current,
            ...detail.product,
            status:
              detail.product.status === "开发中"
                ? "销售中"
                : detail.product.status,
            colors: detail.colors.map((item) => item.name),
          }));
        else setForm((current) => ({ ...current, code: detail.code }));
      })
      .catch((reason) => setError(reason.message));
  }, [product]);
  const createColor = async (name) => {
    const color = await api("/meta/colors", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setMeta((current) => ({ ...current, colors: [...current.colors, color] }));
  };
  const createCategory = async () => {
    const name = window.prompt("请输入新的产品分类名称");
    if (!name?.trim()) return;
    const category = await api("/meta/product-categories", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setMeta((current) => ({
      ...current,
      categories: [...current.categories, category],
    }));
    set("category", category.name);
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      const saved = await api(
        product ? `/products/${product.id}` : "/products",
        { method: product ? "PUT" : "POST", body: JSON.stringify(form) },
      );
      onSave(saved);
    } catch (reason) {
      setError(reason.message);
    }
  };
  return (
    <div className="modal-shade">
      <form className="modal product-form" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>{product ? "EDIT PRODUCT PROFILE" : "NEW PRODUCT PROFILE"}</p>
            <h2>{product ? "编辑产品基础档案" : "新建产品基础档案"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <section className="form-section product-basic-form">
          <h3>基础资料</h3>
          <div className="form-grid">
            <label>
              产品编号
              <input value={form.code} disabled />
            </label>
            <label>
              产品名称
              <input
                value={form.name || ""}
                onChange={(event) => set("name", event.target.value)}
                required
              />
            </label>
            <div className="full product-form-three">
              <label>
                货号
                <input
                  value={form.sku || ""}
                  onChange={(event) => set("sku", event.target.value)}
                  required
                />
              </label>
              <label>
                状态
                <select
                  value={form.status || "销售中"}
                  onChange={(event) => set("status", event.target.value)}
                >
                  {["销售中", "打样中", "生产中", "停产"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                仓库位置
                <input
                  value={form.warehouse_location || ""}
                  onChange={(event) =>
                    set("warehouse_location", event.target.value)
                  }
                />
              </label>
            </div>
            <label>
              产品分类
              <span className="field-with-button">
                <select
                  value={form.category || ""}
                  onChange={(event) => set("category", event.target.value)}
                >
                  {meta.categories.map((item) => (
                    <option key={item.id}>{item.name}</option>
                  ))}
                </select>
                <button type="button" onClick={createCategory}>
                  新增
                </button>
              </span>
            </label>
            <label>
              布标或品牌
              <input
                value={form.brand || ""}
                onChange={(event) => set("brand", event.target.value)}
                placeholder="如：yoululai、无布标"
              />
            </label>
          </div>
        </section>
        <section className="form-section product-appearance-section">
          <h3>产品外观</h3>
          <div className="product-color-image-row">
            <label className="color-field">
              产品颜色
              <ColorPicker
                values={form.colors || []}
                onChange={(value) => set("colors", value)}
                options={meta.colors}
                onCreate={createColor}
              />
            </label>
            {product ? (
              <ProductImageManager productId={product.id} />
            ) : (
              <section className="editor-block image-editor product-image-pending">
                <div className="block-title">
                  <div>
                    <b>产品图片</b>
                    <small>新建产品保存后即可上传图片</small>
                  </div>
                </div>
                <p className="muted">请先保存产品基础档案。</p>
              </section>
            )}
          </div>
        </section>
        <section className="form-section production-form-section">
          <h3>生产资料</h3>
          <div className="form-grid">
            <label>
              包带情况
              <textarea
                value={form.strap_info || ""}
                onChange={(event) => set("strap_info", event.target.value)}
              />
            </label>
            <label>
              制作工艺及要求
              <textarea
                value={form.process_notes || ""}
                onChange={(event) => set("process_notes", event.target.value)}
              />
            </label>
            <label className="full">
              其他备注
              <textarea
                value={form.notes || ""}
                onChange={(event) => set("notes", event.target.value)}
              />
            </label>
          </div>
        </section>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存产品档案</button>
        </div>
      </form>
    </div>
  );
}

function ProductDetail({ data, onClose }) {
  const { product } = data;
  const [images, setImages] = useState(data.images);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const uploadFile = async (file) => {
    setDragging(false);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return window.alert("请选择 JPG、PNG 或 WebP 图片");
    if (file.size > 20 * 1024 * 1024)
      return window.alert("图片不能超过 20MB，请压缩后重新上传");
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = await api(`/products/${product.id}/images`, {
        method: "POST",
        body: JSON.stringify({ dataUrl, type: "正面" }),
      });
      setImages((current) => [...current, image]);
    } catch (error) {
      window.alert(error.message);
    } finally {
      setUploading(false);
    }
  };
  const upload = async (event) => {
    await uploadFile(event.target.files?.[0]);
    event.target.value = "";
  };
  const handleDragOver = (event) => {
    event.preventDefault();
    if (uploading) return;
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const handleDrop = (event) => {
    event.preventDefault();
    if (!uploading) uploadFile(event.dataTransfer.files?.[0]);
  };
  const removeImage = async (image) => {
    if (!window.confirm("确认删除这张产品图片吗？")) return;
    await api(`/products/${product.id}/images/${image.id}`, {
      method: "DELETE",
    });
    setImages((current) => current.filter((item) => item.id !== image.id));
  };
  return (
    <div className="modal-shade">
      <section className="modal detail product-detail">
        <div className="modal-head">
          <div>
            <p>
              {product.code} · 货号 {product.sku}
            </p>
            <h2>{product.name}</h2>
          </div>
          <button onClick={onClose}>×</button>
        </div>
        <section className="profile-grid">
          <div
            className={`image-gallery${dragging ? " is-dragging" : ""}`}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            title="拖入图片或点击上传"
          >
            <div className="image-hero">
              {images[0]?.url ? (
                <img src={images[0].url} alt={product.name} />
              ) : (
                <span>
                  产品图片
                  <br />
                  <small>待上传</small>
                </span>
              )}
            </div>
            <div className="image-actions">
              <label className="upload-button">
                {uploading ? "上传中…" : "+ 添加图片"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={upload}
                  disabled={uploading}
                />
              </label>
              {images.map((image) => (
                <button
                  className="image-mini"
                  type="button"
                  key={image.id}
                  onClick={() => removeImage(image)}
                >
                  <img src={image.url} alt="产品缩略图" />
                  <span>删除</span>
                </button>
              ))}
            </div>
          </div>
          <div className="detail-cards">
            <article>
              <b>基础资料</b>
              <p>
                分类：{product.category}　状态：
                <Status value={product.status} />
              </p>
              <p>
                布标或品牌：{product.brand || "—"}　库位：
                {product.warehouse_location || "—"}
              </p>
              <p>
                颜色：
                <span className="tag-list">
                  {data.colors.map((item) => (
                    <i key={item.id}>{item.name}</i>
                  ))}
                </span>
              </p>
              <p className="profile-notes">
                <b>备注信息：</b>
                <span className="pre-line">{product.notes || "—"}</span>
              </p>
            </article>
            <article>
              <b>包带情况</b>
              <p>{product.strap_info || "—"}</p>
            </article>
            <article className="wide">
              <b>制作工艺及要求</b>
              <p className="pre-line">{product.process_notes || "—"}</p>
            </article>
          </div>
        </section>
        <section className="detail-section">
          <div className="block-title">
            <div>
              <b>裁片资料</b>
              <small>尺寸为展开后的最大外轮廓；每条说明均完整保留</small>
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th>裁片</th>
                <th>材料</th>
                <th>最大尺寸</th>
                <th>片数</th>
                <th>备注说明</th>
                <th>刀模</th>
              </tr>
            </thead>
            <tbody>
              {data.parts.map((part) => (
                <tr key={part.id}>
                  <td>
                    <b>{part.name}</b>
                    <small>{part.code}</small>
                  </td>
                  <td>{part.material_name || "—"}</td>
                  <td>
                    {part.max_length_cm} × {part.max_width_cm} cm
                  </td>
                  <td>{part.quantity_per_product}</td>
                  <td className="note-cell">{part.notes || "—"}</td>
                  <td>
                    {part.mold_code ? (
                      <span className="mold-thumb">
                        {part.mold_image_url ? (
                          <img src={part.mold_image_url} alt="刀模" />
                        ) : (
                          <i>模</i>
                        )}
                        {part.mold_code}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="detail-section">
          <div className="block-title">
            <div>
              <b>配件资料</b>
              <small>可用于后续 BOM 与采购</small>
            </div>
          </div>
          {data.accessories.length ? (
            <table className="accessory-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>材质</th>
                  <th>规格</th>
                  <th>数量</th>
                  <th>备注说明</th>
                </tr>
              </thead>
              <tbody>
                {data.accessories.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.material || "—"}</td>
                    <td>{item.specification || "—"}</td>
                    <td>
                      {item.quantity ?? "—"} {item.unit || ""}
                    </td>
                    <td>{item.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">暂无配件资料。</p>
          )}
        </section>
      </section>
    </div>
  );
}

const emptyCustomer = {
  code: "",
  name: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  currency: "CNY",
  deliveryRequirements: "",
  notes: "",
  isActive: true,
};

function CustomerForm({ customer, onClose, onSave }) {
  const [form, setForm] = useState(
    customer
      ? {
          code: customer.code || "",
          name: customer.name || "",
          contactName: customer.contact_name || "",
          phone: customer.phone || "",
          email: customer.email || "",
          address: customer.address || "",
          currency: customer.currency || "CNY",
          deliveryRequirements: customer.delivery_requirements || "",
          notes: customer.notes || "",
          isActive: Boolean(customer.is_active),
        }
      : emptyCustomer,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(customer ? `/customers/${customer.id}` : "/customers", {
        method: customer ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      onSave();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="modal-shade">
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>{customer ? "EDIT CUSTOMER PROFILE" : "NEW CUSTOMER PROFILE"}</p>
            <h2>{customer ? "编辑客户档案" : "新建客户档案"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-grid">
          <label>
            客户编号
            <input value={form.code} onChange={(event) => set("code", event.target.value)} placeholder="留空自动生成" />
          </label>
          <label>
            公司企业
            <input value={form.name} onChange={(event) => set("name", event.target.value)} required />
          </label>
          <label>
            联系人
            <input value={form.contactName} onChange={(event) => set("contactName", event.target.value)} />
          </label>
          <label>
            联系电话
            <input value={form.phone} onChange={(event) => set("phone", event.target.value)} />
          </label>
          <label>
            电子邮箱
            <input type="email" value={form.email} onChange={(event) => set("email", event.target.value)} />
          </label>
          <label>
            默认币种
            <select value={form.currency} onChange={(event) => set("currency", event.target.value)}>
              {["CNY", "USD", "EUR", "JPY", "KRW", "GBP"].map((currency) => <option key={currency}>{currency}</option>)}
            </select>
          </label>
          <label className="full">
            公司地址
            <input value={form.address} onChange={(event) => set("address", event.target.value)} />
          </label>
          <label className="full">
            交付要求
            <textarea value={form.deliveryRequirements} onChange={(event) => set("deliveryRequirements", event.target.value)} />
          </label>
          <label className="full">
            备注
            <textarea value={form.notes} onChange={(event) => set("notes", event.target.value)} />
          </label>
          <label>
            档案状态
            <select value={form.isActive ? "1" : "0"} onChange={(event) => set("isActive", event.target.value === "1")}>
              <option value="1">启用</option>
              <option value="0">停用</option>
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary" disabled={saving}>{saving ? "保存中…" : "保存客户档案"}</button>
        </div>
      </form>
    </div>
  );
}

function Customers() {
  const [keyword, setKeyword] = useState("");
  const [active, setActive] = useState("all");
  const [editing, setEditing] = useState(undefined);
  const { data, error, reload } = useRequest(
    `/customers?active=${active}&keyword=${encodeURIComponent(keyword)}`,
  );
  const toggleStatus = async (customer) => {
    try {
      await api(`/customers/${customer.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !customer.is_active }),
      });
      reload();
    } catch (reason) {
      window.alert(`无法更新客户状态：${reason.message}`);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState text="正在加载客户档案…" />;
  return (
    <>
      <Header
        title="客户档案"
        subtitle="客户资料管理 / CUSTOMER DIRECTORY"
        action={<button className="primary" onClick={() => setEditing(null)}>+ 新建客户</button>}
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search">⌕<input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索客户编号、公司、联系人或电话" /></div>
          <select value={active} onChange={(event) => setActive(event.target.value)} aria-label="筛选客户状态">
            <option value="all">全部状态</option>
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
          <span>{data.length} 条记录</span>
        </div>
        {data.length ? (
          <table>
            <thead><tr><th>客户编号</th><th>公司企业</th><th>联系人</th><th>联系方式</th><th>币种</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{data.map((customer) => (
              <tr key={customer.id}>
                <td><b>{customer.code}</b></td>
                <td><b>{customer.name}</b><small>{customer.address || "—"}</small></td>
                <td>{customer.contact_name || "—"}</td>
                <td>{customer.phone || "—"}<small>{customer.email || ""}</small></td>
                <td>{customer.currency || "CNY"}</td>
                <td><span className={`archive-state archive-state-${customer.is_active ? "complete" : "empty"}`}>{customer.is_active ? "启用" : "停用"}</span></td>
                <td className="actions">
                  <button onClick={() => setEditing(customer)}>编辑</button>
                  <button className={customer.is_active ? "danger" : ""} onClick={() => toggleStatus(customer)}>{customer.is_active ? "停用" : "启用"}</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted">暂无符合条件的客户档案。</p>}
      </section>
      {editing !== undefined && <CustomerForm customer={editing} onClose={() => setEditing(undefined)} onSave={() => { setEditing(undefined); reload(); }} />}
    </>
  );
}

function Products() {
  const [keyword, setKeyword] = useState("");
  const { data, error, reload } = useRequest(
    `/products?keyword=${encodeURIComponent(keyword)}`,
  );
  const [editing, setEditing] = useState(undefined);
  const [detail, setDetail] = useState(null);
  const save = () => {
    setEditing(undefined);
    reload();
  };
  const showDetail = async (product) => {
    try {
      setDetail(await api(`/products/${product.id}/detail`));
    } catch (reason) {
      window.alert(reason.message);
    }
  };
  const remove = async (product) => {
    const warning = `确认彻底删除产品「${product.sku} · ${product.name}」吗？\n\n当前状态：${product.status || "未设置"}\n关联的裁片、配件、配货规则、下料方案及历史配货/采购单都会同步删除，且无法恢复。`;
    if (!window.confirm(warning)) return;
    try {
      const result = await api(`/products/${product.id}`, { method: "DELETE" });
      setEditing(undefined);
      setDetail(null);
      await reload();
      const removed = [];
      if (result.deliveryOrders)
        removed.push(`${result.deliveryOrders} 张历史配货单`);
      if (result.purchaseOrders)
        removed.push(`${result.purchaseOrders} 张采购单`);
      window.alert(
        removed.length
          ? `产品已删除，同时删除：${removed.join("、")}`
          : "产品档案已删除",
      );
    } catch (reason) {
      window.alert(`无法删除产品：${reason.message}`);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <Header
        title="产品档案"
        subtitle="产品管理 / PRODUCT LIBRARY"
        action={
          <button className="primary" onClick={() => setEditing(null)}>
            + 新建产品
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            ⌕
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索货号、系统编号、名称、分类或颜色"
            />
          </div>
          <span>{data.length} 条记录</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>货号 / 系统编号</th>
              <th>产品名称</th>
              <th>颜色</th>
              <th>布标或品牌</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((product) => {
              const open = () => showDetail(product);
              return (
                <tr
                  className="archive-row"
                  key={product.id}
                  role="link"
                  tabIndex="0"
                  onClick={open}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      open();
                    }
                  }}
                >
                  <td>
                    <b>{product.sku}</b>
                    <small>{product.code}</small>
                  </td>
                  <td>
                    <b>{product.name}</b>
                    <small>{product.category}</small>
                  </td>
                  <td>{product.colors_text || "—"}</td>
                  <td>{product.brand || "—"}</td>
                  <td>
                    <Status value={product.status} />
                  </td>
                  <td className="actions">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        open();
                      }}
                    >
                      完整资料
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        setEditing(product);
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(product);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <ProductForm
          product={editing}
          onClose={() => setEditing(undefined)}
          onSave={save}
        />
      )}{" "}
      {detail && (
        <ProductDetail data={detail} onClose={() => setDetail(null)} />
      )}
    </>
  );
}

function MaterialForm({ material, onClose, onSave }) {
  const [form, setForm] = useState(material || emptyMaterial);
  const [categories, setCategories] = useState([]);
  const [colors, setColors] = useState([]);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState("");
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    Promise.all([
      api("/material-categories"),
      api("/meta/colors"),
      api("/units"),
    ])
      .then(([categoryData, colorData, unitData]) => {
        setCategories(categoryData);
        setColors(colorData);
        setUnits(unitData);
      })
      .catch((reason) => setError(reason.message));
  }, []);
  const addColor = async () => {
    const name = window.prompt("请输入材料颜色");
    if (!name?.trim()) return;
    const color = await api("/meta/colors", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setColors((items) => [...items, color]);
    set("color", color.name);
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(material ? `/materials/${material.id}` : "/materials", {
        method: material ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      onSave();
    } catch (reason) {
      setError(reason.message);
    }
  };
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>{material ? "EDIT MATERIAL" : "NEW MATERIAL"}</p>
            <h2>{material ? "编辑材料" : "新增材料"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-grid">
          {[
            ["name", "材料名称"],
            ["specification", "规格尺寸"],
            ["supplier", "供应商"],
            ["width_cm", "有效幅宽（cm）"],
            ["weight_gsm", "重量（g / gsm）"],
            ["roll_length_cm", "每卷长度（cm）"],
            ["unit_price", "单价 / 每米单价（元）"],
            ["image_url", "图片链接"],
          ].map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type={
                  [
                    "width_cm",
                    "weight_gsm",
                    "roll_length_cm",
                    "unit_price",
                  ].includes(field)
                    ? "number"
                    : "text"
                }
                min="0"
                step="any"
                value={form[field] || ""}
                onChange={(event) => set(field, event.target.value)}
                required={field === "name"}
              />
            </label>
          ))}
          <label>
            材料分类
            <select
              value={form.category_name || "面布"}
              onChange={(event) => set("category_name", event.target.value)}
            >
              {categories.map((item) => (
                <option key={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            单位
            <select
              value={form.unit || "m"}
              onChange={(event) => set("unit", event.target.value)}
            >
              {units.map((item) => (
                <option key={item.id} value={item.symbol}>
                  {item.name}（{item.symbol}）
                </option>
              ))}
            </select>
          </label>
          <label>
            材料颜色
            <span className="field-with-button">
              <input
                list="material-colors"
                value={form.color || ""}
                onChange={(event) => set("color", event.target.value)}
                placeholder="选择或输入新颜色"
              />
              <datalist id="material-colors">
                {colors.map((color) => (
                  <option value={color.name} key={color.id} />
                ))}
              </datalist>
              <button type="button" onClick={addColor}>
                新增
              </button>
            </span>
          </label>
          <label className="full">
            备注
            <textarea
              value={form.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存材料</button>
        </div>
      </form>
    </div>
  );
}
function Materials() {
  const { data, error, reload } = useRequest("/materials");
  const [editing, setEditing] = useState(undefined);
  const remove = async (item) => {
    if (!window.confirm(`确认删除「${item.name}」吗？`)) return;
    try {
      await api(`/materials/${item.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      window.alert(`无法删除：${reason.message}`);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <Header
        title="材料库"
        subtitle="材料管理 / MATERIAL CATALOG"
        action={
          <button className="primary" onClick={() => setEditing(null)}>
            + 新增材料
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <span>共 {data.length} 条材料；颜色可与产品颜色复用</span>
          <span className="muted">新增、编辑后自动同步颜色主数据</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>材料名称</th>
              <th>分类</th>
              <th>规格 / 颜色</th>
              <th>单位 / 幅宽</th>
              <th>供应商</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id}>
                <td>
                  <small>{item.code}</small>
                </td>
                <td>
                  <b>{item.name}</b>
                </td>
                <td>{item.category_name || "—"}</td>
                <td>
                  {item.specification || "—"}
                  <small>{item.color || "未设置颜色"}</small>
                </td>
                <td>
                  {item.unit}
                  <small>
                    {item.width_cm ? `${item.width_cm} cm` : "未设置幅宽"}
                  </small>
                </td>
                <td>{item.supplier || "—"}</td>
                <td className="actions">
                  <button onClick={() => setEditing(item)}>编辑</button>
                  <button className="danger" onClick={() => remove(item)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <MaterialForm
          material={editing}
          onClose={() => setEditing(undefined)}
          onSave={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </>
  );
}
function ResourceTable({ type }) {
  const path = type === "molds" ? "/molds" : "/materials";
  const { data, error, reload } = useRequest(path);
  const config = {
    molds: {
      title: "刀模库",
      cols: ["刀模编号", "名称", "产品", "图片", "库位"],
      row: (item) => [
        item.code,
        item.name,
        item.product_sku || "—",
        item.image_url ? "已上传" : "待上传",
        item.storage_location || "—",
      ],
    },
  }[type];
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <Header title={config.title} subtitle="刀模管理 / MOLD CATALOG" />
      <section className="panel">
        <table>
          <thead>
            <tr>
              {config.cols.map((item) => (
                <th key={item}>{item}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id}>
                {config.row(item).map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
function BomCalculator() {
  const { data: products } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [plans, setPlans] = useState([]);
  const [fabricRules, setFabricRules] = useState([]);
  const [selectedFabricRuleIds, setSelectedFabricRuleIds] = useState([]);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (products?.[0] && !productId) setProductId(String(products[0].id));
  }, [products, productId]);
  useEffect(() => {
    if (!productId) return;
    api(`/products/${productId}/delivery-rules`)
      .then((rules) => {
        const colors = [
          ...new Set(rules.map((rule) => rule.color).filter(Boolean)),
        ];
        const fabrics = rules.filter((rule) => rule.category !== "配件");
        setPlans(
          colors.length
            ? colors.map((color) => ({ color, quantity: 0 }))
            : [{ color: "", quantity: 0 }],
        );
        setFabricRules(fabrics);
        setSelectedFabricRuleIds(
          fabrics
            .filter((rule) => Number(rule.quantity_per_product) === 10)
            .map((rule) => rule.id),
        );
        setResult(null);
      })
      .catch((reason) => setMessage(reason.message));
  }, [productId]);
  const updatePlan = (index, field, value) =>
    setPlans((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  const toggleFabric = (id) =>
    setSelectedFabricRuleIds((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
    );
  const calculate = async () => {
    try {
      setResult(
        await api("/bom/smart-delivery", {
          method: "POST",
          body: JSON.stringify({
            productId: Number(productId),
            colorPlans: plans,
            selectedFabricRuleIds,
          }),
        }),
      );
      setMessage("");
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  const fabricItems =
    result?.groups
      .filter((group) => group.category !== "配件")
      .flatMap((group) => group.items) || [];
  const longAccessories =
    result?.groups
      .find((group) => group.category === "配件")
      ?.items.filter((item) => item.cutting_length_cm) || [];
  const normalAccessories =
    result?.groups
      .find((group) => group.category === "配件")
      ?.items.filter((item) => !item.cutting_length_cm) || [];
  return (
    <>
      <Header title="BOM 智能配货" subtitle="BOM / SMART DELIVERY" />
      <section className="calculator smart-calculator">
        <div className="panel controls">
          <p>输入生产计划</p>
          <h2>按颜色自动配货</h2>
          <label>
            产品
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              {products?.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          <div className="color-plan">
            <b>颜色与数量</b>
            <small>每个颜色单独填写生产数量</small>
            {plans.map((plan, index) => (
              <span key={`${plan.color}-${index}`}>
                <input
                  value={plan.color}
                  onChange={(event) =>
                    updatePlan(index, "color", event.target.value)
                  }
                  placeholder="颜色"
                />
                <input
                  type="number"
                  min="0"
                  value={plan.quantity}
                  onChange={(event) =>
                    updatePlan(index, "quantity", event.target.value)
                  }
                  placeholder="数量"
                />
              </span>
            ))}
            <button
              type="button"
              onClick={() =>
                setPlans((items) => [...items, { color: "", quantity: 0 }])
              }
            >
              + 增加颜色
            </button>
          </div>
          <div className="fabric-options">
            <b>布料裁剪方案</b>
            <small>默认勾选“单张 10 包”方案；可改选其它排版</small>
            {fabricRules.map((rule) => (
              <label key={rule.id}>
                <input
                  type="checkbox"
                  checked={selectedFabricRuleIds.includes(rule.id)}
                  onChange={() => toggleFabric(rule.id)}
                />
                <span>
                  {rule.material_name} · {rule.color || "通用"} · 单张{" "}
                  {rule.quantity_per_product} 包 · {rule.cutting_length_cm}cm{" "}
                  {rule.description || ""}
                </span>
              </label>
            ))}
          </div>
          <button className="primary big" onClick={calculate}>
            生成裁剪配货清单 →
          </button>
          {message && <div className="notice">{message}</div>}
        </div>
        <div className="panel result">
          <div className="section-title">
            <div>
              <p>SMART DELIVERY RESULT</p>
              <h2>
                {result
                  ? `${result.product.sku} · ${result.productionQuantity} 件`
                  : "等待生成配货清单"}
              </h2>
            </div>
          </div>
          {result ? (
            <>
              {result.warnings.map((warning) => (
                <p className="notice" key={warning}>
                  {warning}
                </p>
              ))}
              <section className="delivery-group">
                <h3>布料 / 里布裁剪配货</h3>
                <table>
                  <thead>
                    <tr>
                      <th>布料材质</th>
                      <th>颜色</th>
                      <th>单张包数</th>
                      <th>拉布长度</th>
                      <th>拉布总数</th>
                      <th>总米数</th>
                      <th>裁剪方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fabricItems.map((item) => (
                      <tr key={`${item.id}-${item.planColor}`}>
                        <td>
                          <b>{item.material_name}</b>
                          <small>{item.description || "—"}</small>
                        </td>
                        <td>{item.materialColor}</td>
                        <td>{item.quantity_per_product} 包</td>
                        <td>{item.cutting_length_cm} cm</td>
                        <td>{item.layCount} 层</td>
                        <td className="required">{item.requiredQuantity} m</td>
                        <td>
                          {item.cutting_mode}
                          {item.mold_code ? ` · ${item.mold_code}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {longAccessories.length ? (
                <section className="delivery-group">
                  <h3>长度型配件配货（拉链布、织带、绳子）</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>物品名称</th>
                        <th>材质</th>
                        <th>颜色</th>
                        <th>单包长度</th>
                        <th>单包数量</th>
                        <th>配货总数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {longAccessories.map((item) => (
                        <tr key={`${item.id}-${item.planColor}`}>
                          <td>{item.material_name}</td>
                          <td>{item.materialType}</td>
                          <td>{item.materialColor}</td>
                          <td>{item.cutting_length_cm} cm</td>
                          <td>
                            {item.quantity_per_product} {item.unit}
                          </td>
                          <td className="required">
                            {item.totalPieces} {item.unit} / {item.totalLengthM}{" "}
                            m
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
              {normalAccessories.length ? (
                <section className="delivery-group">
                  <h3>其他配件配货</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>物品名称</th>
                        <th>材质</th>
                        <th>颜色</th>
                        <th>规格</th>
                        <th>单包数量</th>
                        <th>配货总数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normalAccessories.map((item) => (
                        <tr key={`${item.id}-${item.planColor}`}>
                          <td>{item.material_name}</td>
                          <td>{item.materialType}</td>
                          <td>{item.materialColor}</td>
                          <td>{item.description || "—"}</td>
                          <td>
                            {item.quantity_per_product} {item.unit}
                          </td>
                          <td className="required">
                            {item.totalPieces} {item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ) : null}
            </>
          ) : (
            <div className="empty">
              选择产品后，填写每个颜色的生产数量，并选择所需布料裁剪方案。
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function ApiDocs() {
  return (
    <>
      <Header
        title="微信小程序查询接口"
        subtitle="MINIPROGRAM / READ-ONLY API"
      />
      <section className="panel docs">
        <p>
          小程序可读取产品颜色、包带、配件、裁片、刀模、下料方案及配货清单快照。
        </p>
        {[
          ["GET", "/api/miniprogram/products?keyword=2073", "按产品信息搜索"],
          ["GET", "/api/miniprogram/products/:id", "读取完整产品资料"],
          [
            "GET",
            "/api/miniprogram/delivery-orders?keyword=2073",
            "搜索历史配货清单",
          ],
          [
            "GET",
            "/api/miniprogram/delivery-orders/:id",
            "读取配货、成本和选定下料方案",
          ],
        ].map(([method, url, desc]) => (
          <article key={url}>
            <b className="method">{method}</b>
            <code>{url}</code>
            <span>{desc}</span>
          </article>
        ))}
      </section>
    </>
  );
}

const packingColors = [
  "#dcebd5",
  "#f7dca8",
  "#cfe7e3",
  "#eadcf0",
  "#f2c8b8",
  "#d9e0f2",
  "#e7e6bb",
];
function PackingDiagram({ material }) {
  const scroller = useRef(null);
  const drag = useRef(null);
  const [dragging, setDragging] = useState(false);
  const scale = 4;
  const left = 12;
  const top = 10;
  const length = Math.max(material.usedLengthCm, 1);
  const fabricWidth = material.usableWidthCm;
  const occupiedWidth = Math.max(
    ...material.pieces.map((piece) => piece.x + piece.width),
    0,
  );
  const lengthTicks = Array.from(
    { length: Math.floor(length / 10) + 1 },
    (_, index) => index * 10,
  );
  const widthTicks = Array.from(
    { length: Math.floor(fabricWidth / 10) + 1 },
    (_, index) => index * 10,
  );
  const pointerDown = (event) => {
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.current.scrollLeft,
      top: scroller.current.scrollTop,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event) => {
    if (!drag.current) return;
    scroller.current.scrollLeft =
      drag.current.left - (event.clientX - drag.current.x);
    scroller.current.scrollTop =
      drag.current.top - (event.clientY - drag.current.y);
  };
  const pointerUp = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div
      ref={scroller}
      className={`packing-canvas ${dragging ? "dragging" : ""}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      <svg
        style={{
          width: (length + left + 4) * scale,
          height: (fabricWidth + top + 4) * scale,
        }}
        viewBox={`0 0 ${length + left + 4} ${fabricWidth + top + 4}`}
        role="img"
        aria-label={`${material.materialName} 横向排料图`}
      >
        <rect
          x={left}
          y={top}
          width={length}
          height={fabricWidth}
          fill="#f8f2e7"
          stroke="#315b50"
          strokeWidth=".5"
        />
        {lengthTicks.map((tick) => (
          <g key={`l-${tick}`}>
            <line
              x1={left + tick}
              y1={top - 1.6}
              x2={left + tick}
              y2={top}
              stroke="#496c62"
              strokeWidth=".35"
            />
            <text
              x={left + tick}
              y={top - 2.5}
              textAnchor="middle"
              fontSize="2.5"
              fill="#315b50"
            >
              {tick}cm
            </text>
          </g>
        ))}
        {widthTicks.map((tick) => (
          <g key={`w-${tick}`}>
            <line
              x1={left - 1.5}
              y1={top + tick}
              x2={left}
              y2={top + tick}
              stroke="#496c62"
              strokeWidth=".35"
            />
            <text
              x={left - 2.2}
              y={top + tick + 0.8}
              textAnchor="end"
              fontSize="2.5"
              fill="#315b50"
            >
              {tick}
            </text>
          </g>
        ))}
        <text
          x="1"
          y={top + fabricWidth / 2}
          transform={`rotate(-90 1 ${top + fabricWidth / 2})`}
          textAnchor="middle"
          fontSize="3"
          fontWeight="700"
          fill="#173532"
        >
          幅宽 {fabricWidth}cm · 实际占用 {occupiedWidth.toFixed(1)}cm
        </text>
        {material.pieces.map((piece) => {
          const x = left + piece.y,
            y = top + piece.x,
            w = piece.height,
            h = piece.width;
          return (
            <g key={`${piece.partId}-${piece.instance}`}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx=".6"
                fill={packingColors[piece.partId % packingColors.length]}
                stroke="#315b50"
                strokeWidth=".4"
              >
                <title>
                  {piece.name} #{piece.instance} · 裁剪 {piece.width}×
                  {piece.height}cm{piece.rotated ? " · 已旋转" : ""}
                </title>
              </rect>
              <text
                x={x + w / 2}
                y={y + h / 2 - 1.5}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="3"
                fontWeight="700"
                fill="#173532"
              >
                {piece.name}
              </text>
              <text
                x={x + w / 2}
                y={y + h / 2 + 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="2.35"
                fill="#315b50"
              >
                {piece.width}×{piece.height}cm
              </text>
            </g>
          );
        })}
        <line
          x1={left + length}
          y1={top - 2}
          x2={left + length}
          y2={top + fabricWidth + 2}
          stroke="#d18424"
          strokeWidth=".7"
          strokeDasharray="2 1"
        />
        <text
          x={left + length - 1}
          y={top + fabricWidth + 3.5}
          textAnchor="end"
          fontSize="3"
          fontWeight="700"
          fill="#a45f11"
        >
          布长 {length}cm
        </text>
      </svg>
    </div>
  );
}
function ProductCostCalculator() {
  const { data: products, error } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [gap, setGap] = useState(1);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [extras, setExtras] = useState({
    lossRate: 1,
    processingUnit: 0,
    packagingUnit: 0,
    other: 0,
  });
  const setExtra = (field, value) =>
    setExtras((current) => ({ ...current, [field]: Number(value) || 0 }));
  const calculate = async (save = false) => {
    try {
      setBusy(true);
      setMessage("");
      const data = await api(save ? "/packing/plans" : "/packing/calculate", {
        method: "POST",
        body: JSON.stringify({
          productId,
          productionQuantity: quantity,
          gapCm: gap,
        }),
      });
      setResult(data);
      setMessage(save ? `排料核算 ${data.planNo} 已保存` : "排料计算完成");
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorState error={error} />;
  if (!products) return <LoadingState />;
  const count = Math.max(1, Number(quantity));
  const materialBase = Number(result?.totalMaterialCost || 0);
  const loss = (materialBase * extras.lossRate) / 100;
  const processing = extras.processingUnit * count;
  const packaging = extras.packagingUnit * count;
  const totalCost = materialBase + loss + processing + packaging + extras.other;
  const fabricCost = Number(result?.fabricCost || 0);
  const accessoryCost = Number(result?.accessoryCost || 0);
  return (
    <>
      <Header
        title="产品成本核算"
        subtitle="RECTPACK / MATERIAL COSTING"
        action={
          result ? (
            <span className="maintenance-actions">
              <button onClick={() => window.print()}>打印成本单</button>
              <button
                className="primary"
                onClick={() => calculate(true)}
                disabled={busy}
              >
                保存核算
              </button>
            </span>
          ) : null
        }
      />
      <section className="packing-workspace">
        <aside className="panel packing-controls">
          <p>PACKING INPUT</p>
          <h2>排料参数</h2>
          <label>
            产品
            <SearchableSelect
              value={productId}
              onChange={(value) => {
                setProductId(value);
                setResult(null);
              }}
              ariaLabel="搜索并选择核算产品"
              placeholder="输入货号或产品名称搜索"
              options={products.map((product) => ({
                value: product.id,
                label: `${product.sku} · ${product.name}`,
              }))}
            />
          </label>
          <label>
            排版套数
            <div className="quantity-presets">
              {[1, 5, 10, 20].map((item) => (
                <button
                  type="button"
                  className={Number(quantity) === item ? "active" : ""}
                  key={item}
                  onClick={() => setQuantity(item)}
                >
                  {item}套
                </button>
              ))}
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            裁片间隙（cm）
            <input
              type="number"
              min="0"
              step="0.1"
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            />
          </label>
          <button
            className="primary big"
            onClick={() => calculate(false)}
            disabled={busy || !productId}
          >
            {busy ? "正在智能排料…" : "生成智能排料 →"}
          </button>
          {message && (
            <p className={result ? "notice neutral" : "notice"}>{message}</p>
          )}
          <div className="packing-note">
            每一种布料独立排料、独立计价。画布保持实际比例，按住可横向拖拽。
          </div>
        </aside>
        <section className="packing-results">
          {result ? (
            <>
              <div className="packing-hero panel">
                <div>
                  <p>COST OVERVIEW</p>
                  <h2>
                    {result.product.sku} · {count}套成本核算
                  </h2>
                  <span>
                    {result.materials.length} 种布料 ·{" "}
                    {result.accessories.length} 种配件
                  </span>
                </div>
                <strong>
                  {formatMoney(totalCost / count)}
                  <small>单套总成本</small>
                </strong>
              </div>
              {result.materials.map((material) => (
                <article
                  className="panel packing-material"
                  key={`${material.materialId}-${material.materialColor}`}
                >
                  <div className="packing-material-head">
                    <div>
                      <small>{material.algorithm.toUpperCase()}</small>
                      <h3>
                        {material.materialName}
                        {material.materialColor
                          ? ` · ${material.materialColor}`
                          : ""}
                      </h3>
                    </div>
                    <div>
                      <b>{material.usedLengthCm} cm</b>
                      <span>
                        用料 {material.usedLengthM}m · 幅宽{" "}
                        {material.usableWidthCm}cm · 利用率{" "}
                        {material.utilizationRate}% ·{" "}
                        {formatMoney(material.materialCost)}
                      </span>
                    </div>
                  </div>
                  <PackingDiagram material={material} />
                </article>
              ))}
              <section className="panel redesigned-cost">
                <div className="cost-section-head">
                  <div>
                    <p>COST SUMMARY</p>
                    <h2>成本汇总</h2>
                    <span>每种布料单独核算，并列显示批量与单套成本</span>
                  </div>
                  <div className="cost-grand">
                    <small>{count}套总成本</small>
                    <strong>{formatMoney(totalCost)}</strong>
                    <span>单套 {formatMoney(totalCost / count)}</span>
                  </div>
                </div>
                <div className="quote-inputs cost-settings">
                  {[
                    ["lossRate", "材料损耗率 %"],
                    ["processingUnit", "单套加工费"],
                    ["packagingUnit", "单套包装费"],
                    ["other", "整批其他费用"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={extras[field]}
                        onChange={(event) =>
                          setExtra(field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="material-cost-list">
                  <div className="cost-list-head">
                    <span>成本项目</span>
                    <span>用量 / 说明</span>
                    <span>{count}套成本</span>
                    <span>单套成本</span>
                  </div>
                  {result.materials.map((material) => (
                    <article key={`cost-${material.materialId}`}>
                      <span>
                        <i
                          style={{
                            background:
                              packingColors[
                                material.materialId % packingColors.length
                              ],
                          }}
                        />
                        <b>{material.materialName}</b>
                        <small>布料</small>
                      </span>
                      <span>
                        {material.usedLengthM}m
                        <small>
                          幅宽 {material.usableWidthCm}cm · 利用率{" "}
                          {material.utilizationRate}%
                        </small>
                      </span>
                      <strong>{formatMoney(material.materialCost)}</strong>
                      <strong>
                        {formatMoney(material.materialCost / count)}
                      </strong>
                    </article>
                  ))}
                  <article>
                    <span>
                      <i className="accessory-dot" />
                      <b>配件与五金</b>
                      <small>{result.accessories.length} 种</small>
                    </span>
                    <span>
                      {count}套用量<small>调用配件档案与价格</small>
                    </span>
                    <strong>{formatMoney(accessoryCost)}</strong>
                    <strong>{formatMoney(accessoryCost / count)}</strong>
                  </article>
                </div>
                <div className="cost-fee-grid">
                  <article>
                    <small>布料合计</small>
                    <b>{formatMoney(fabricCost)}</b>
                    <span>单套 {formatMoney(fabricCost / count)}</span>
                  </article>
                  <article>
                    <small>配件合计</small>
                    <b>{formatMoney(accessoryCost)}</b>
                    <span>单套 {formatMoney(accessoryCost / count)}</span>
                  </article>
                  <article>
                    <small>材料损耗</small>
                    <b>{formatMoney(loss)}</b>
                    <span>{extras.lossRate}%</span>
                  </article>
                  <article>
                    <small>加工费</small>
                    <b>{formatMoney(processing)}</b>
                    <span>单套 {formatMoney(extras.processingUnit)}</span>
                  </article>
                  <article>
                    <small>包装费</small>
                    <b>{formatMoney(packaging)}</b>
                    <span>单套 {formatMoney(extras.packagingUnit)}</span>
                  </article>
                  <article>
                    <small>其他费用</small>
                    <b>{formatMoney(extras.other)}</b>
                    <span>整批计入</span>
                  </article>
                </div>
                <div className="cost-final-row">
                  <div>
                    <small>{count}套材料与费用合计</small>
                    <b>{formatMoney(totalCost)}</b>
                  </div>
                  <div>
                    <small>总成本 ÷ {count}套</small>
                    <strong>{formatMoney(totalCost / count)}</strong>
                    <span>单套总成本</span>
                  </div>
                </div>
                {result.accessories.length ? (
                  <details className="accessory-details">
                    <summary>
                      查看配件与五金明细（{result.accessories.length}项）
                    </summary>
                    <div>
                      {result.accessories.map((item) => (
                        <span key={item.id}>
                          {item.name}
                          <small>
                            {item.quantity} {item.unit || ""}
                          </small>
                          <b>{formatMoney(item.cost)}</b>
                        </span>
                      ))}
                    </div>
                  </details>
                ) : null}
              </section>
            </>
          ) : (
            <div className="panel empty packing-empty">
              选择产品和排版套数后生成排料图
              <br />
              系统将自动比较 MaxRects 与 Skyline 策略
            </div>
          )}
        </section>
      </section>
    </>
  );
}
function LegacyAIQuoteAssistant() {
  const initialCode = `XK-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.floor(100 + Math.random() * 900)}`;
  const blank = {
    quoteCode: initialCode,
    productName: initialCode,
    quantity: 10,
    gapCm: 1,
    lossRate: 1,
    processingUnit: 0,
    packagingUnit: 0,
    otherCost: 0,
    materials: [],
    accessories: [],
    missingFields: ["请提供至少一种布料及其裁片"],
    conflicts: [],
    readyForPacking: false,
  };
  const [draft, setDraft] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("bpms-ai-quote-draft")) || blank;
    } catch {
      return blank;
    }
  });
  const [config, setConfig] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "请描述新款的套数、每种布料、裁片尺寸和配件。我会整理后指出缺少的数据。",
  );
  const [result, setResult] = useState(null);
  const [image, setImage] = useState(null);
  useEffect(() => {
    api("/ai-quotes/config")
      .then(setConfig)
      .catch(() => setConfig({ configured: false }));
  }, []);
  useEffect(() => {
    localStorage.setItem("bpms-ai-quote-draft", JSON.stringify(draft));
  }, [draft]);
  const change = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setResult(null);
  };
  const updateMaterial = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      materials: current.materials.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    }));
    setResult(null);
  };
  const updatePiece = (mi, pi, field, value) => {
    setDraft((current) => ({
      ...current,
      materials: current.materials.map((material, i) =>
        i === mi
          ? {
              ...material,
              pieces: material.pieces.map((piece, j) =>
                j === pi ? { ...piece, [field]: value } : piece,
              ),
            }
          : material,
      ),
    }));
    setResult(null);
  };
  const updateAccessory = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      accessories: current.accessories.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    }));
    setResult(null);
  };
  const ask = async () => {
    if (!text.trim()) return;
    try {
      setBusy(true);
      const data = await api("/ai-quotes/extract", {
        method: "POST",
        body: JSON.stringify({ message: text, draft }),
      });
      setDraft(data.draft);
      setMessage(data.assistantMessage);
      setText("");
      setResult(data.result || null);
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    const data = await api("/ai-quotes/validate", {
      method: "POST",
      body: JSON.stringify({ draft }),
    });
    setDraft(data);
    return data;
  };
  const calculate = async () => {
    try {
      setBusy(true);
      const checked = await validate();
      if (!checked.readyForPacking) {
        setMessage(
          `还不能排料：${checked.missingFields.slice(0, 3).join("；")}`,
        );
        return;
      }
      const data = await api("/ai-quotes/calculate", {
        method: "POST",
        body: JSON.stringify({ draft: checked }),
      });
      setResult(data);
      setMessage("资料校验通过，已完成每种布料的独立排料和成本核算。");
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  const addMaterial = () =>
    setDraft((current) => ({
      ...current,
      materials: [
        ...current.materials,
        {
          id: `m${Date.now()}`,
          name: `布料${current.materials.length + 1}`,
          widthCm: "",
          unitPrice: "",
          priceUnit: "元/米",
          pieces: [],
        },
      ],
    }));
  const addPiece = (mi) =>
    setDraft((current) => ({
      ...current,
      materials: current.materials.map((m, i) =>
        i === mi
          ? {
              ...m,
              pieces: [
                ...m.pieces,
                {
                  id: `p${Date.now()}`,
                  name: "新裁片",
                  lengthCm: "",
                  widthCm: "",
                  quantityPerSet: 1,
                  rotatable: true,
                },
              ],
            }
          : m,
      ),
    }));
  const reset = () => {
    if (!confirm("清空当前新款报价草稿吗？")) return;
    const code = `XK-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.floor(100 + Math.random() * 900)}`;
    setDraft({ ...blank, quoteCode: code, productName: code });
    setResult(null);
    setMessage(`已创建新款编号 ${code}，请直接告诉我裁片、布料和配件资料。`);
    setImage(null);
  };
  const money = (value) => formatMoney(Number(value) || 0);
  return (
    <>
      <Header
        title="AI 新产品核价助手"
        subtitle="DEEPSEEK / NEW PRODUCT QUOTING"
        action={<button onClick={reset}>新建报价</button>}
      />
      <section className="ai-quote-layout">
        <section className="panel ai-conversation">
          <div className="ai-status">
            <span className={config?.configured ? "online" : "offline"}>
              {config?.configured ? "DeepSeek 已连接" : "DeepSeek 未配置"}
            </span>
            <small>{config?.model || "检查服务中"}</small>
          </div>
          <div className="ai-bubble">
            <b>核价助手</b>
            <p>{message}</p>
          </div>
          {image && (
            <div className="ai-image-preview">
              <img src={image.url} alt="用户上传的参考图" />
              <span>
                <b>{image.name}</b>
                <small>
                  当前版本不会自动读取图中尺寸，请把关键数字同时写在文字中。
                </small>
              </span>
              <button onClick={() => setImage(null)}>移除</button>
            </div>
          )}
          <label className="ai-prompt">
            <span>描述新款资料</span>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="例如：做20套，棉麻幅宽148cm、18元/米；前片45×30cm，每套2片……"
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                  ask();
              }}
            />
            <small>
              Ctrl + Enter 发送。AI只整理资料，尺寸、排料和成本由程序校验计算。
            </small>
          </label>
          <div className="ai-actions">
            <label className="ai-upload">
              上传参考图
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    setImage({
                      name: file.name,
                      url: URL.createObjectURL(file),
                    });
                }}
              />
            </label>
            <button
              className="primary"
              onClick={ask}
              disabled={busy || !text.trim()}
            >
              {busy ? "正在处理…" : "发送并整理资料 →"}
            </button>
          </div>
        </section>
        <section className="ai-data-column">
          <section className="panel quote-checklist">
            <div className="section-title">
              <div>
                <p>QUOTE DATA</p>
                <h2>报价数据草稿</h2>
              </div>
              <span
                className={`quote-readiness ${draft.readyForPacking ? "ready" : "pending"}`}
              >
                {draft.readyForPacking ? "可以排料" : "待补充"}
              </span>
            </div>
            <div className="quote-basic-grid">
              {[
                ["productName", "新款名称", "text"],
                ["quantity", "报价套数", "number"],
                ["gapCm", "裁片间隙 cm", "number"],
                ["lossRate", "材料损耗率 %", "number"],
                ["processingUnit", "单套加工费", "number"],
                ["packagingUnit", "单套包装费", "number"],
                ["otherCost", "整批其他费用", "number"],
              ].map(([field, label, type]) => (
                <label key={field}>
                  {label}
                  <input
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    step="any"
                    value={draft[field] ?? ""}
                    onChange={(event) => change(field, event.target.value)}
                  />
                </label>
              ))}
            </div>
            {draft.missingFields?.length > 0 && (
              <div className="quote-missing">
                <b>仍需确认</b>
                {draft.missingFields.slice(0, 5).map((item) => (
                  <span key={item}>· {item}</span>
                ))}
              </div>
            )}
            <div className="quote-block-title">
              <div>
                <b>布料与裁片</b>
                <small>每一种布料单独排料</small>
              </div>
              <button onClick={addMaterial}>+ 添加布料</button>
            </div>
            {draft.materials.map((material, mi) => (
              <article
                className="quote-material-editor"
                key={material.id || mi}
              >
                <div className="quote-material-fields">
                  <input
                    value={material.name || ""}
                    onChange={(event) =>
                      updateMaterial(mi, "name", event.target.value)
                    }
                    placeholder="布料名称"
                  />
                  <label>
                    幅宽 cm
                    <input
                      type="number"
                      min="0"
                      value={material.widthCm ?? ""}
                      onChange={(event) =>
                        updateMaterial(mi, "widthCm", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    单价 元/米
                    <input
                      type="number"
                      min="0"
                      value={material.unitPrice ?? ""}
                      onChange={(event) =>
                        updateMaterial(mi, "unitPrice", event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="danger"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        materials: current.materials.filter((_, i) => i !== mi),
                      }))
                    }
                  >
                    删除
                  </button>
                </div>
                {material.pieces.map((piece, pi) => (
                  <div className="quote-piece-row" key={piece.id || pi}>
                    <input
                      value={piece.name || ""}
                      onChange={(event) =>
                        updatePiece(mi, pi, "name", event.target.value)
                      }
                      placeholder="裁片名称"
                    />
                    <input
                      type="number"
                      min="0"
                      value={piece.lengthCm ?? ""}
                      onChange={(event) =>
                        updatePiece(mi, pi, "lengthCm", event.target.value)
                      }
                      placeholder="长 cm"
                    />
                    <span>×</span>
                    <input
                      type="number"
                      min="0"
                      value={piece.widthCm ?? ""}
                      onChange={(event) =>
                        updatePiece(mi, pi, "widthCm", event.target.value)
                      }
                      placeholder="宽 cm"
                    />
                    <input
                      type="number"
                      min="1"
                      value={piece.quantityPerSet ?? 1}
                      onChange={(event) =>
                        updatePiece(
                          mi,
                          pi,
                          "quantityPerSet",
                          event.target.value,
                        )
                      }
                      placeholder="片/套"
                    />
                    <label className="rotate-check">
                      <input
                        type="checkbox"
                        checked={piece.rotatable !== false}
                        onChange={(event) =>
                          updatePiece(mi, pi, "rotatable", event.target.checked)
                        }
                      />
                      可旋转
                    </label>
                    <button
                      className="danger"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          materials: current.materials.map((m, i) =>
                            i === mi
                              ? {
                                  ...m,
                                  pieces: m.pieces.filter((_, j) => j !== pi),
                                }
                              : m,
                          ),
                        }))
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button className="add-row" onClick={() => addPiece(mi)}>
                  + 添加裁片
                </button>
              </article>
            ))}
            <div className="quote-block-title">
              <div>
                <b>配件与五金</b>
                <small>按单套用量和单位价格计算</small>
              </div>
              <button
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    accessories: [
                      ...current.accessories,
                      {
                        id: `a${Date.now()}`,
                        name: "新配件",
                        specification: "",
                        quantityPerSet: 1,
                        unit: "个",
                        unitPrice: "",
                      },
                    ],
                  }))
                }
              >
                + 添加配件
              </button>
            </div>
            {draft.accessories.map((item, index) => (
              <div className="quote-accessory-row" key={item.id || index}>
                <input
                  value={item.name || ""}
                  onChange={(event) =>
                    updateAccessory(index, "name", event.target.value)
                  }
                  placeholder="配件名称"
                />
                <input
                  value={item.specification || ""}
                  onChange={(event) =>
                    updateAccessory(index, "specification", event.target.value)
                  }
                  placeholder="规格"
                />
                <input
                  type="number"
                  min="0"
                  value={item.quantityPerSet ?? ""}
                  onChange={(event) =>
                    updateAccessory(index, "quantityPerSet", event.target.value)
                  }
                  placeholder="单套用量"
                />
                <input
                  value={item.unit || ""}
                  onChange={(event) =>
                    updateAccessory(index, "unit", event.target.value)
                  }
                  placeholder="单位"
                />
                <input
                  type="number"
                  min="0"
                  value={item.unitPrice ?? ""}
                  onChange={(event) =>
                    updateAccessory(index, "unitPrice", event.target.value)
                  }
                  placeholder="单价"
                />
                <button
                  className="danger"
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      accessories: current.accessories.filter(
                        (_, i) => i !== index,
                      ),
                    }))
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="quote-calc-actions">
              <button onClick={validate}>检查数据</button>
              <button className="primary" onClick={calculate} disabled={busy}>
                校验并开始排料 →
              </button>
            </div>
          </section>
          {result && (
            <>
              <section className="panel ai-cost-result">
                <div>
                  <p>QUOTE RESULT</p>
                  <h2>
                    {result.product.name} · {result.productionQuantity}套
                  </h2>
                  <span>
                    {result.materials.length}种布料 ·{" "}
                    {result.accessories.length}种配件
                  </span>
                </div>
                <div>
                  <small>单套总成本</small>
                  <strong>{money(result.unitCost)}</strong>
                  <span>
                    {result.productionQuantity}套合计 {money(result.totalCost)}
                  </span>
                </div>
              </section>
              {result.materials.map((material) => (
                <article
                  className="panel packing-material"
                  key={material.materialId}
                >
                  <div className="packing-material-head">
                    <div>
                      <small>{material.algorithm.toUpperCase()}</small>
                      <h3>{material.materialName}</h3>
                    </div>
                    <div>
                      <b>{material.usedLengthCm} cm</b>
                      <span>
                        用料 {material.usedLengthM}m · 幅宽{" "}
                        {material.usableWidthCm}cm · 利用率{" "}
                        {material.utilizationRate}% ·{" "}
                        {money(material.materialCost)}
                      </span>
                    </div>
                  </div>
                  <PackingDiagram material={material} />
                </article>
              ))}
              <section className="panel ai-cost-breakdown">
                <h2>成本汇总</h2>
                <div>
                  <span>
                    布料成本<strong>{money(result.fabricCost)}</strong>
                    <small>
                      单套{" "}
                      {money(result.fabricCost / result.productionQuantity)}
                    </small>
                  </span>
                  <span>
                    配件成本<strong>{money(result.accessoryCost)}</strong>
                    <small>
                      单套{" "}
                      {money(result.accessoryCost / result.productionQuantity)}
                    </small>
                  </span>
                  <span>
                    材料损耗<strong>{money(result.lossCost)}</strong>
                    <small>{result.lossRate}%</small>
                  </span>
                  <span>
                    加工与包装
                    <strong>
                      {money(
                        (result.processingUnit + result.packagingUnit) *
                          result.productionQuantity,
                      )}
                    </strong>
                    <small>按 {result.productionQuantity} 套</small>
                  </span>
                  <span className="total">
                    总成本<strong>{money(result.totalCost)}</strong>
                    <small>单套 {money(result.unitCost)}</small>
                  </span>
                </div>
              </section>
            </>
          )}
        </section>
      </section>
    </>
  );
}

function LegacyProductCostCalculator() {
  const { data: products, error } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(10);
  const [gap, setGap] = useState(1);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [extras, setExtras] = useState({
    lossRate: 1,
    processingUnit: 0,
    packagingUnit: 0,
    other: 0,
  });
  const setExtra = (field, value) =>
    setExtras((current) => ({ ...current, [field]: Number(value) || 0 }));
  const calculate = async (save = false) => {
    try {
      setBusy(true);
      setMessage("");
      const data = await api(save ? "/packing/plans" : "/packing/calculate", {
        method: "POST",
        body: JSON.stringify({
          productId,
          productionQuantity: quantity,
          gapCm: gap,
        }),
      });
      setResult(data);
      setMessage(
        save
          ? `排料核算 ${data.planNo} 已保存`
          : "已完成多算法比较并选出用料最短方案",
      );
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  if (error) return <ErrorState error={error} />;
  if (!products) return <LoadingState />;
  const count = Math.max(1, Number(quantity));
  const base = Number(result?.totalMaterialCost || 0);
  const loss = (base * extras.lossRate) / 100;
  const processing =
    (extras.processingUnit + extras.packagingUnit) * count + extras.other;
  const totalCost = base + loss + processing;
  const fabricCost = Number(result?.fabricCost || 0);
  const accessoryCost = Number(result?.accessoryCost || 0);
  return (
    <>
      <Header
        title="产品成本核算"
        subtitle="RECTPACK / MATERIAL COSTING"
        action={
          result ? (
            <span className="maintenance-actions">
              <button onClick={() => window.print()}>打印成本单</button>
              <button
                className="primary"
                onClick={() => calculate(true)}
                disabled={busy}
              >
                保存核算
              </button>
            </span>
          ) : null
        }
      />
      <section className="packing-workspace">
        <aside className="panel packing-controls">
          <p>PACKING INPUT</p>
          <h2>排料参数</h2>
          <label>
            产品
            <SearchableSelect
              value={productId}
              onChange={(value) => {
                setProductId(value);
                setResult(null);
              }}
              ariaLabel="搜索并选择核算产品"
              placeholder="输入货号或产品名称搜索"
              options={products.map((product) => ({
                value: product.id,
                label: `${product.sku} · ${product.name}`,
              }))}
            />
          </label>
          <label>
            排版套数
            <div className="quantity-presets">
              {[1, 5, 10, 20].map((item) => (
                <button
                  type="button"
                  className={Number(quantity) === item ? "active" : ""}
                  key={item}
                  onClick={() => setQuantity(item)}
                >
                  {item}套
                </button>
              ))}
            </div>
            <input
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>
          <label>
            裁片间隙（cm）
            <input
              type="number"
              min="0"
              step="0.1"
              value={gap}
              onChange={(event) => setGap(event.target.value)}
            />
          </label>
          <button
            className="primary big"
            onClick={() => calculate(false)}
            disabled={busy || !productId}
          >
            {busy ? "正在智能排料…" : "生成智能排料 →"}
          </button>
          {message && (
            <p className={result ? "notice neutral" : "notice"}>{message}</p>
          )}
          <div className="packing-note">
            画布按实际比例横向展开：高度代表布料幅宽，横向代表使用长度。按住画布可左右拖拽查看。
          </div>
        </aside>
        <section className="packing-results">
          {result ? (
            <>
              <div className="packing-hero panel">
                <div>
                  <p>COST OVERVIEW</p>
                  <h2>
                    {result.product.sku} · {result.productionQuantity}套成本核算
                  </h2>
                  <span>
                    {result.materials.length} 种布料 ·{" "}
                    {result.accessories.length} 种配件
                  </span>
                </div>
                <strong>
                  {formatMoney(totalCost / count)}
                  <small>单套总成本</small>
                </strong>
              </div>
              {result.materials.map((material) => (
                <article
                  className="panel packing-material"
                  key={`${material.materialId}-${material.materialColor}`}
                >
                  <div className="packing-material-head">
                    <div>
                      <small>{material.algorithm.toUpperCase()}</small>
                      <h3>
                        {material.materialName}
                        {material.materialColor
                          ? ` · ${material.materialColor}`
                          : ""}
                      </h3>
                    </div>
                    <div>
                      <b>{material.usedLengthCm} cm</b>
                      <span>
                        用料 {material.usedLengthM}m · 幅宽{" "}
                        {material.usableWidthCm}cm · 利用率{" "}
                        {material.utilizationRate}% ·{" "}
                        {formatMoney(material.materialCost)}
                      </span>
                    </div>
                  </div>
                  <PackingDiagram material={material} />
                </article>
              ))}
              <section className="panel quote-sheet">
                <div className="section-title">
                  <div>
                    <p>COST SUMMARY</p>
                    <h2>成本汇总</h2>
                  </div>
                </div>
                <div className="quote-inputs">
                  {[
                    ["lossRate", "材料损耗率 %"],
                    ["processingUnit", "单套加工费"],
                    ["packagingUnit", "单套包装费"],
                    ["other", "整批其他费用"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={extras[field]}
                        onChange={(event) =>
                          setExtra(field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="cost-summary-text">
                  <h3>
                    {result.product.sku} · {count}套材料使用总结
                  </h3>
                  {result.materials.map((material) => (
                    <p key={`summary-${material.materialId}`}>
                      <b>{material.materialName}</b>：{count}套，幅宽{" "}
                      {material.usableWidthCm}cm，用料{" "}
                      <strong>{material.usedLengthM}m</strong>，利用率{" "}
                      {material.utilizationRate}%，成本{" "}
                      <b>{formatMoney(material.materialCost)}</b>
                    </p>
                  ))}
                  <p>
                    <b>
                      {count}套配件与五金成本：{formatMoney(accessoryCost)}
                    </b>
                  </p>
                </div>
                <div className="unit-cost-grid">
                  <article>
                    <small>单套面料成本</small>
                    <strong>{formatMoney(faceCost / count)}</strong>
                  </article>
                  <article>
                    <small>单套里布成本</small>
                    <strong>{formatMoney(liningCost / count)}</strong>
                  </article>
                  <article>
                    <small>单套布料成本</small>
                    <strong>{formatMoney(fabricCost / count)}</strong>
                  </article>
                  <article>
                    <small>单套配件成本</small>
                    <strong>{formatMoney(accessoryCost / count)}</strong>
                  </article>
                  <article className="unit-cost-total">
                    <small>单套总成本</small>
                    <strong>{formatMoney(totalCost / count)}</strong>
                  </article>
                </div>
                <table>
                  <tbody>
                    <tr>
                      <td>{count}套面料与里布成本</td>
                      <td>{formatMoney(fabricCost)}</td>
                    </tr>
                    <tr>
                      <td>{count}套配件与五金成本</td>
                      <td>{formatMoney(accessoryCost)}</td>
                    </tr>
                    <tr>
                      <td>材料损耗（{extras.lossRate}%）</td>
                      <td>{formatMoney(loss)}</td>
                    </tr>
                    <tr>
                      <td>{count}套加工、包装及其他费用</td>
                      <td>{formatMoney(processing)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="quote-total cost-only-total">
                  <span>
                    {count}套总成本 <strong>{formatMoney(totalCost)}</strong>
                  </span>
                  <span>
                    单套总成本 <strong>{formatMoney(totalCost / count)}</strong>
                  </span>
                </div>
                {result.accessories.length ? (
                  <div className="packing-accessories">
                    <h3>配件档案调用明细</h3>
                    {result.accessories.map((item) => (
                      <span key={item.id}>
                        {item.name} · {item.quantity} {item.unit || ""} ·{" "}
                        {formatMoney(item.cost)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <div className="panel empty packing-empty">
              选择产品和排版套数后生成排料图
              <br />
              系统将自动比较 MaxRects 与 Skyline 策略
            </div>
          )}
        </section>
      </section>
    </>
  );
}
function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      setMessage("");
      const session = await api(
        "/v1/auth/login",
        { method: "POST", body: JSON.stringify(form) },
        false,
      );
      setAccessToken(session.accessToken);
      sessionStorage.setItem("bpms-user", JSON.stringify(session.user));
      onLogin(session.user);
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <img src="/zhiyuan-mark.svg" alt="" />
          <span>
            <b>知源</b>
            <small>手袋 BOM 配货管理系统</small>
          </span>
        </div>
        <div>
          <p>SECURE WORKSPACE</p>
          <h1>登录生产资料系统</h1>
          <small>仅限已授权员工使用，所有数据操作均会记录。</small>
        </div>
        <form onSubmit={submit}>
          <label>
            用户名
            <input
              autoComplete="username"
              value={form.username}
              onChange={(event) =>
                setForm((value) => ({ ...value, username: event.target.value }))
              }
              required
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) =>
                setForm((value) => ({ ...value, password: event.target.value }))
              }
              required
            />
          </label>
          {message && <p className="error">{message}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "正在登录…" : "安全登录 →"}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserManagement({
  embedded = false,
  currentUser = (() => {
    try {
      return JSON.parse(sessionStorage.getItem("bpms-user"));
    } catch {
      return null;
    }
  })(),
}) {
  const { data, error, reload } = useRequest("/v1/users");
  const [editing, setEditing] = useState(undefined);
  const [message, setMessage] = useState("");
  const effectiveCurrentUser =
    currentUser ||
    (() => {
      try {
        return JSON.parse(sessionStorage.getItem("bpms-user"));
      } catch {
        return null;
      }
    })();
  const save = async (event) => {
    event.preventDefault();
    try {
      setMessage("");
      await api(editing.id ? `/v1/users/${editing.id}` : "/v1/users", {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(editing),
      });
      setEditing(undefined);
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  const remove = async (user) => {
    if (user.id === effectiveCurrentUser?.id) return;
    if (!confirm(`确定删除账号“${user.username}”吗？该操作会写入审计日志。`))
      return;
    try {
      setMessage("");
      await api(`/v1/users/${user.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      {!embedded && <Header
        title="用户管理"
        subtitle="SYSTEM / USERS & PERMISSIONS"
        action={
          <button
            className="primary"
            onClick={() =>
              setEditing({
                username: "",
                displayName: "",
                password: "",
                role: "member",
                isActive: true,
              })
            }
          >
            + 新增用户
          </button>
        }
      />}
      {embedded && (
        <div className="embedded-users-actions">
          <button
            className="primary"
            onClick={() => setEditing({ username: "", displayName: "", password: "", role: "member", isActive: true })}
          >
            + 新增用户
          </button>
        </div>
      )}
      {message && <p className="error">{message}</p>}
      <section className={embedded ? "embedded-users-panel" : "panel"}>
        <div className="toolbar">
          <span>管理员拥有全部权限；普通用户可新增和编辑，但不能删除。</span>
          <b>{data.length} 个账号</b>
        </div>
        <table>
          <thead>
            <tr>
              <th>账号</th>
              <th>姓名</th>
              <th>角色</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((user) => (
              <tr key={user.id}>
                <td>
                  <b>{user.username}</b>
                </td>
                <td>{user.displayName}</td>
                <td>{user.role === "admin" ? "管理员" : "普通用户"}</td>
                <td>{user.isActive ? "正常" : "已停用"}</td>
                <td>{formatDate(user.lastLoginAt)}</td>
                <td className="actions">
                  <button onClick={() => setEditing({ ...user, password: "" })}>
                    编辑
                  </button>
                  {user.id !== currentUser?.id && (
                    <button className="danger" onClick={() => remove(user)}>
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <div className="modal-shade">
          <form className="modal material-form" onSubmit={save}>
            <div className="modal-head">
              <div>
                <p>USER ACCOUNT</p>
                <h2>{editing.id ? "编辑用户" : "新增用户"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(undefined)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              {!editing.id && (
                <label>
                  用户名
                  <input
                    value={editing.username}
                    onChange={(event) =>
                      setEditing((value) => ({
                        ...value,
                        username: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
              )}
              <label>
                姓名
                <input
                  value={editing.displayName || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      displayName: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                角色
                <select
                  value={editing.role}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      role: event.target.value,
                    }))
                  }
                >
                  <option value="member">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
              <label>
                {editing.id ? "重置密码（留空不修改）" : "初始密码"}
                <input
                  type="password"
                  value={editing.password || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      password: event.target.value,
                    }))
                  }
                  required={!editing.id}
                  minLength="10"
                />
              </label>
              {editing.id && (
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={editing.isActive !== false}
                    onChange={(event) =>
                      setEditing((value) => ({
                        ...value,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  账号启用
                </label>
              )}
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button className="primary">保存用户</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function App({ user, onLogout }) {
  const pageKeys = [
    "dashboard",
    "archivesHub",
    "deliveryHub",
    "agent",
    "aiQuote",
    "quotations",
    "products",
    "customers",
    "parts",
    "accessories",
    "processes",
    "fabrics",
    "lengthMaterials",
    "hardware",
    "processLibrary",
    "molds",
    "cuttingPlans",
    "bom",
    "productCost",
    "deliveryHistory",
    "deliveryCost",
    "deliveryRules",
    "settings",
    "agentSettings",
    "api",
  ];
  const readPage = () => {
    const hashPage = window.location.hash.replace(/^#\/?/, "");
    const savedPage = window.localStorage.getItem("bpms-current-page");
    return pageKeys.includes(hashPage)
      ? hashPage
      : pageKeys.includes(savedPage)
        ? savedPage
        : "dashboard";
  };
  const [page, setPageState] = useState(readPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [systemSettings, setSystemSettings] = useState(null);
  const setPage = (nextPage) => {
    const validPage = pageKeys.includes(nextPage) ? nextPage : "dashboard";
    window.localStorage.setItem("bpms-current-page", validPage);
    if (window.location.hash !== `#/${validPage}`)
      window.history.replaceState(null, "", `#/${validPage}`);
    setPageState(validPage);
  };
  useEffect(() => {
    const handleHashChange = () => setPageState(readPage());
    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash)
      window.history.replaceState(null, "", `#/${page}`);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);
  useEffect(() => {
    api("/v1/system-settings").then(result => setSystemSettings(result.settings)).catch(() => {});
  }, []);
  const pages = useMemo(
    () => ({
      dashboard: <Dashboard setPage={setPage} />,
      archivesHub: <AppModuleHub type="archivesHub" setPage={setPage} />,
      deliveryHub: <AppModuleHub type="deliveryHub" setPage={setPage} />,
      agent: <AgentWorkspace />,
      aiQuote: <AIQuoteAssistant />,
      quotations: <QuotationWorkspace systemSettings={systemSettings || {}} />,
      products: <Products />,
      customers: <Customers />,
      parts: <MaintenanceWorkspace key="parts" mode="parts" />,
      accessories: (
        <MaintenanceWorkspace key="accessories" mode="accessories" />
      ),
      processes: <ProcessArchiveWorkspace canDelete={user.role === "admin"} />,
      fabrics: (
        <MaterialLibrary
          title="布料库"
          libraryType="fabric"
          categories={[
            "面布",
            "里布",
            "夹层",
            "支撑板",
            "复合布",
            "其它",
            "布料",
          ]}
        />
      ),
      lengthMaterials: (
        <MaterialLibrary
          title="线材库"
          libraryType="length"
          categories={["长度材料", "织带", "绳子", "拉链"]}
        />
      ),
      hardware: (
        <MaterialLibrary
          title="配件库"
          libraryType="hardware"
          categories={["五金配件", "标牌配件", "五金"]}
        />
      ),
      processLibrary: <WorkProcessLibrary />,
      molds: <MoldLibrary />,
      cuttingPlans: <CuttingPlanLibraryV2 />,
      bom: <SmartBomCalculator />,
      productCost: <ProductCostCalculator />,
      deliveryHistory: <DeliveryHistory />,
      deliveryCost: <DeliveryCost />,
      deliveryRules: <MaintenanceWorkspace key="rules" mode="rules" />,
      settings: <SystemSettings user={user} onSettingsChanged={setSystemSettings} onPasswordChanged={onLogout} userManagement={user.role === "admin" ? <UserManagement currentUser={user} embedded /> : null} />,
      agentSettings: <AgentSettings />,
      api: <ApiDocs />,
    }),
    [page, user.role],
  );
  return (
    <div
      className={`app ${user.role === "admin" ? "admin-mode" : "member-mode"}`}
    >
      <ModalDismissBehavior />
      <button
        className="mobile-topbar"
        type="button"
        onClick={() => setMenuOpen(true)}
      >
        <img src={systemSettings?.logoThumbnailUrl || systemSettings?.logoUrl || "/zhiyuan-mark.svg"} alt="" />
        <span>{systemSettings?.systemName || "知源 BPMS"}</span>
        <i>菜单</i>
      </button>
      <Sidebar
        page={page}
        setPage={setPage}
        user={user}
        onLogout={onLogout}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        systemSettings={systemSettings}
      />
      <main>
        <MobilePageBack page={page} setPage={setPage} />
        <PageErrorBoundary page={page}>{pages[page]}</PageErrorBoundary>
      </main>
      <AppBottomNav page={page} setPage={setPage} />
    </div>
  );
}

const noLoginUser = {
  id: 0,
  username: "local",
  displayName: "免登录管理员",
  role: "admin",
};

async function loadNoLoginUser() {
  clearAccessToken();
  const result = await api("/v1/auth/me", {}, false);
  const user = result?.user || noLoginUser;
  sessionStorage.setItem("bpms-user", JSON.stringify(user));
  return user;
}

function AuthGate() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const logout = async () => {
    try {
      await api("/v1/auth/logout", { method: "POST" }, false);
    } catch {}
    try {
      setUser(await loadNoLoginUser());
    } catch {
      sessionStorage.setItem("bpms-user", JSON.stringify(noLoginUser));
      setUser(noLoginUser);
    }
  };
  useEffect(() => {
    let active = true;
    const restore = async () => {
      try {
        const nextUser = await loadNoLoginUser();
        if (active) setUser(nextUser);
      } catch {
        sessionStorage.setItem("bpms-user", JSON.stringify(noLoginUser));
        if (active) setUser(noLoginUser);
      } finally {
        if (active) setChecking(false);
      }
    };
    restore();
    const expired = () => {
      loadNoLoginUser()
        .then((nextUser) => {
          if (active) setUser(nextUser);
        })
        .catch(() => {
          sessionStorage.setItem("bpms-user", JSON.stringify(noLoginUser));
          if (active) setUser(noLoginUser);
        });
    };
    window.addEventListener("bpms-auth-expired", expired);
    return () => {
      active = false;
      window.removeEventListener("bpms-auth-expired", expired);
    };
  }, []);
  if (checking) return <div className="app-loading">正在验证登录状态…</div>;
  const effectiveUser = user || noLoginUser;
  return (
    <>
      <ResponsiveTableLabels />
      <App user={effectiveUser} onLogout={logout} />
    </>
  );
}

function PendingModule({ title, subtitle, description }) {
  return (
    <>
      <Header title={title} subtitle={subtitle} />
      <section className="panel pending-module">
        <span>功能规划中</span>
        <h2>{title}</h2>
        <p>{description}</p>
        <small>当前入口已经建立，后续可直接在此模块继续开发。</small>
      </section>
    </>
  );
}
const appRoot =
  globalThis.__bpmsRoot || createRoot(document.getElementById("root"));
globalThis.__bpmsRoot = appRoot;
appRoot.render(<AuthGate />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );

function LegacySmartBomCalculator() {
  const { data: products } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [plans, setPlans] = useState([]);
  const [selectedRuleIds, setSelectedRuleIds] = useState([]);
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (products?.[0] && !productId) setProductId(String(products[0].id));
  }, [products, productId]);
  useEffect(() => {
    if (!productId) return;
    api(`/products/${productId}/delivery-rules`)
      .then((rules) => {
        setPlans([{ color: "", quantity: 0 }]);
        setSelectedRuleIds(
          rules
            .filter(
              (rule) =>
                rule.library_type === "布料库" &&
                Number(rule.quantity_per_product) === 10,
            )
            .map((rule) => rule.id),
        );
        setResult(null);
      })
      .catch((error) => setMessage(error.message));
  }, [productId]);
  const calculate = async (ruleIds = selectedRuleIds) => {
    try {
      setResult(
        await api("/bom/smart-delivery", {
          method: "POST",
          body: JSON.stringify({
            productId: Number(productId),
            colorPlans: plans,
            selectedFabricRuleIds: ruleIds,
          }),
        }),
      );
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const toggle = (id) => {
    const next = selectedRuleIds.includes(id)
      ? selectedRuleIds.filter((item) => item !== id)
      : [...selectedRuleIds, id];
    setSelectedRuleIds(next);
    if (result) calculate(next);
  };
  const setPlan = (index, field, value) =>
    setPlans((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  const fabricItems =
    result?.groups.find((group) => group.libraryType === "布料库")?.items || [];
  const lengthItems =
    result?.groups.find((group) => group.libraryType === "长度材料库")?.items ||
    [];
  const hardwareItems =
    result?.groups.find((group) => group.libraryType === "五金配件库")?.items ||
    [];
  return (
    <>
      <Header title="BOM 智能配货" subtitle="BOM / SMART DELIVERY" />
      <section className="calculator">
        <div className="panel controls">
          <p>输入生产计划</p>
          <h2>按颜色自动配货</h2>
          <label>
            产品
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
            >
              {products?.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.sku} · {product.name}
                </option>
              ))}
            </select>
          </label>
          {plans.map((plan, index) => (
            <label key={`${plan.color}-${index}`}>
              {index ? "增加颜色" : "颜色与数量"}
              <span className="quantity-input">
                <input
                  value={plan.color}
                  onChange={(event) =>
                    setPlan(index, "color", event.target.value)
                  }
                  placeholder="颜色"
                />
                <input
                  type="number"
                  min="0"
                  value={plan.quantity}
                  onChange={(event) =>
                    setPlan(index, "quantity", event.target.value)
                  }
                  placeholder="数量"
                />
              </span>
            </label>
          ))}
          <button
            type="button"
            onClick={() =>
              setPlans((items) => [...items, { color: "", quantity: 0 }])
            }
          >
            + 增加颜色
          </button>
          <div className="legend">
            <p>
              <b>布料库：</b>订单数 ÷ 单张包数，向上取整后 × 拉布长度。
            </p>
            <p>
              <b>长度材料库：</b>订单数 × 单包数量 ×
              单包长度，并换算米数和卷数。
            </p>
            <p>
              <b>五金配件库：</b>订单数 × 单包数量，直接得到配货总数。
            </p>
          </div>
          <button className="primary big" onClick={() => calculate()}>
            生成裁剪配货清单 →
          </button>
          {message && <p className="notice">{message}</p>}
        </div>
        <div className="panel result">
          <div className="section-title">
            <div>
              <p>SMART DELIVERY RESULT</p>
              <h2>
                {result
                  ? `${result.product.sku} · ${result.productionQuantity} 件`
                  : "等待生成配货清单"}
              </h2>
            </div>
          </div>
          {result ? (
            <>
              {result.warnings.map((warning) => (
                <p className="notice" key={warning}>
                  {warning}
                </p>
              ))}
              <section className="delivery-group">
                <h3>布料库配货</h3>
                <table>
                  <thead>
                    <tr>
                      <th>布料材质</th>
                      <th>颜色</th>
                      <th>单张包数</th>
                      <th>拉布长度</th>
                      <th>拉布总数</th>
                      <th>总米数</th>
                      <th>裁剪方式</th>
                      <th>选择</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fabricItems.map((item) => (
                      <tr
                        className={
                          item.isSelected ? "rule-selected" : "rule-muted"
                        }
                        key={`${item.id}-${item.planColor}`}
                      >
                        <td>
                          <b>{item.material_name}</b>
                          <small>
                            {item.description ||
                              item.material_specification ||
                              "—"}
                          </small>
                        </td>
                        <td>{item.materialColor}</td>
                        <td>{item.quantity_per_product} 包</td>
                        <td>{item.cutting_length_cm} cm</td>
                        <td>{item.layCount} 层</td>
                        <td className="required">{item.requiredQuantity} m</td>
                        <td>{item.cutting_mode}</td>
                        <td>
                          <input
                            className="rule-check"
                            type="checkbox"
                            checked={selectedRuleIds.includes(item.id)}
                            onChange={() => toggle(item.id)}
                            aria-label={`选择 ${item.material_name} 裁剪方案`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
              {lengthItems.length ? (
                <DeliveryTable
                  title="长度材料库配货"
                  items={lengthItems}
                  length
                />
              ) : null}
              {hardwareItems.length ? (
                <DeliveryTable title="五金配件库配货" items={hardwareItems} />
              ) : null}
            </>
          ) : (
            <div className="empty">
              配货结果全部来源于“配货规则维护”，请填写颜色和数量后生成。
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function SmartBomCalculator() {
  const { data: products } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [productKeyword, setProductKeyword] = useState("");
  const [plans, setPlans] = useState([{ color: "", quantity: 0 }]);
  const [selectedRuleIds, setSelectedRuleIds] = useState([]);
  const [selectedCuttingPlanIds, setSelectedCuttingPlanIds] = useState({});
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedProduct = products?.find(
    (product) => String(product.id) === String(productId),
  );
  const normalizedProductKeyword = productKeyword
    .trim()
    .toLocaleLowerCase("zh-CN");
  const visibleProducts = (products || []).filter(
    (product) =>
      !normalizedProductKeyword ||
      [product.sku, product.code, product.name].some((value) =>
        String(value || "")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedProductKeyword),
      ),
  );
  const productColors = String(selectedProduct?.colors_text || "")
    .split("、")
    .map((color) => color.trim())
    .filter(Boolean);
  useEffect(() => {
    if (
      normalizedProductKeyword &&
      visibleProducts.length === 1 &&
      String(visibleProducts[0].id) !== String(productId)
    )
      setProductId(String(visibleProducts[0].id));
  }, [normalizedProductKeyword, products]);
  useEffect(() => {
    if (!productId) return;
    api(`/products/${productId}/delivery-rules`)
      .then((rules) => {
        const currentProduct = products?.find(
          (product) => String(product.id) === String(productId),
        );
        const colors = String(currentProduct?.colors_text || "")
          .split("、")
          .map((color) => color.trim())
          .filter(Boolean);
        setPlans([{ color: colors[0] || "", quantity: 0 }]);
        setSelectedRuleIds(
          rules
            .filter(
              (rule) =>
                rule.library_type === "布料库" &&
                Number(rule.quantity_per_product) === 10,
            )
            .map((rule) => rule.id),
        );
        setSelectedCuttingPlanIds({});
        setResult(null);
        setMessage(colors.length ? "" : "请先在产品档案中增加产品颜色");
      })
      .catch((error) => setMessage(error.message));
  }, [productId, products]);
  const setPlan = (index, field, value) =>
    setPlans((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item,
      ),
    );
  const addPlanColor = () => {
    const nextColor = productColors.find(
      (color) => !plans.some((plan) => plan.color === color),
    );
    if (nextColor)
      setPlans((items) => [...items, { color: nextColor, quantity: 0 }]);
  };
  const removePlan = (index) =>
    setPlans((items) => items.filter((_, itemIndex) => itemIndex !== index));
  const calculate = async (ruleIds = selectedRuleIds) => {
    try {
      const calculated = await api("/bom/smart-delivery", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(productId),
          colorPlans: plans,
          selectedFabricRuleIds: ruleIds,
        }),
      });
      const calculatedFabrics =
        calculated.groups.find((group) => group.libraryType === "布料库")
          ?.items || [];
      setSelectedCuttingPlanIds((current) =>
        Object.fromEntries(
          calculatedFabrics
            .map((item) => {
              const key = item.groupKey || String(item.id);
              const currentId = current[key];
              const selected = item.cuttingPlans?.some(
                (plan) => String(plan.id) === String(currentId),
              )
                ? currentId
                : item.cuttingPlans?.[0]?.id;
              return selected ? [key, String(selected)] : null;
            })
            .filter(Boolean),
        ),
      );
      setResult(calculated);
      setMessage("");
    } catch (error) {
      setMessage(error.message);
    }
  };
  const saveOrder = async () => {
    if (!result) return;
    try {
      setSaving(true);
      const order = await api("/delivery-orders", {
        method: "POST",
        body: JSON.stringify({
          productId: Number(productId),
          colorPlans: plans,
          selectedFabricRuleIds: selectedRuleIds,
          selectedCuttingPlanIds,
        }),
      });
      setMessage(
        `配货清单 ${order.order_no} 已保存，可在“配货清单历史”中查看。`,
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (id) => {
    const next = selectedRuleIds.includes(id)
      ? selectedRuleIds.filter((item) => item !== id)
      : [...selectedRuleIds, id];
    setSelectedRuleIds(next);
    if (result) calculate(next);
  };
  const fabricItems =
    result?.groups.find((group) => group.libraryType === "布料库")?.items || [];
  const lengthItems =
    result?.groups.find((group) => group.libraryType === "长度材料库")?.items ||
    [];
  const hardwareItems =
    result?.groups.find((group) => group.libraryType === "五金配件库")?.items ||
    [];
  return (
    <>
      <Header title="BOM 智能配货" subtitle="BOM / SMART DELIVERY" />
      <section className="calculator">
        <div className="panel controls">
          <p>输入生产计划</p>
          <h2>按颜色自动配货</h2>
          <label>
            产品
            <SearchableSelect
              value={productId}
              onChange={setProductId}
              placeholder="输入货号、编号或产品名称"
              ariaLabel="搜索并选择 BOM 产品"
              options={(products || []).map((product) => ({
                value: product.id,
                label: `${product.sku} · ${product.name} · ${product.code}`,
              }))}
            />
          </label>
          {plans.map((plan, index) => (
            <label key={index}>
              {index ? "增加颜色" : "颜色与数量"}
              <span className="quantity-input color-quantity-input">
                <select
                  value={plan.color}
                  onChange={(event) =>
                    setPlan(index, "color", event.target.value)
                  }
                  required
                >
                  <option value="">请选择产品颜色</option>
                  {productColors.map((color) => (
                    <option
                      value={color}
                      key={color}
                      disabled={plans.some(
                        (item, itemIndex) =>
                          itemIndex !== index && item.color === color,
                      )}
                    >
                      {color}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  value={plan.quantity}
                  onChange={(event) =>
                    setPlan(index, "quantity", event.target.value)
                  }
                  placeholder="数量"
                />
                {index > 0 && (
                  <button
                    type="button"
                    className="danger"
                    onClick={() => removePlan(index)}
                  >
                    ×
                  </button>
                )}
              </span>
            </label>
          ))}
          <button
            type="button"
            onClick={addPlanColor}
            disabled={plans.length >= productColors.length}
          >
            + 增加颜色
          </button>
          <div className="legend">
            <p>
              <b>订单颜色：</b>只能从产品档案中的颜色选择。
            </p>
            <p>
              <b>默认：</b>材料跟随产品颜色。
            </p>
            <p>
              <b>特殊情况：</b>配货规则可设置固定颜色或产品颜色对应的材料颜色。
            </p>
          </div>
          <button className="primary big" onClick={() => calculate()}>
            生成裁剪配货清单 →
          </button>
          {message && <p className="notice">{message}</p>}
        </div>
        <div className="panel result">
          <div className="section-title">
            <div>
              <p>SMART DELIVERY RESULT</p>
              <h2>
                {result
                  ? `${result.product.sku} · ${result.productionQuantity} 件`
                  : "等待生成配货清单"}
              </h2>
            </div>
            {result && (
              <button className="primary" onClick={saveOrder} disabled={saving}>
                {saving ? "保存中…" : "保存配货清单"}
              </button>
            )}
          </div>
          {result ? (
            <>
              {result.warnings.map((warning) => (
                <p className="notice" key={warning}>
                  {warning}
                </p>
              ))}
              <section className="delivery-group">
                <h3>布料库配货</h3>
                <table>
                  <thead>
                    <tr>
                      <th>布料材质</th>
                      <th>颜色</th>
                      <th>单张包数</th>
                      <th>拉布长度</th>
                      <th>拉布总数</th>
                      <th>总米数</th>
                      <th>裁剪方式 / 下料参考</th>
                      <th>选择</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fabricItems.map((item) => {
                      const itemKey = item.groupKey || String(item.id);
                      return (
                        <tr
                          className={
                            item.isSelected ? "rule-selected" : "rule-muted"
                          }
                          key={itemKey}
                        >
                          <td>
                            <b>{item.material_name}</b>
                            <small>
                              {item.description ||
                                item.material_specification ||
                                "—"}
                            </small>
                          </td>
                          <td>
                            {item.materialColor}
                            {item.sourcePlanColors?.length > 1 && (
                              <small>
                                合并订单色：{item.sourcePlanColors.join("、")}
                              </small>
                            )}
                          </td>
                          <td>{item.quantity_per_product} 包</td>
                          <td>{item.cutting_length_cm} cm</td>
                          <td>{item.layCount} 层</td>
                          <td className="required">
                            {item.requiredQuantity} m
                          </td>
                          <td>
                            <CuttingPlanChoice
                              plans={item.cuttingPlans}
                              selectedId={selectedCuttingPlanIds[itemKey]}
                              onSelect={(planId) =>
                                setSelectedCuttingPlanIds((current) => ({
                                  ...current,
                                  [itemKey]: String(planId),
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="rule-check"
                              type="checkbox"
                              checked={selectedRuleIds.includes(item.id)}
                              onChange={() => toggle(item.id)}
                              aria-label={`选择 ${item.material_name} 裁剪方案`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              {lengthItems.length ? (
                <DeliveryTable title="线材库配货" items={lengthItems} length />
              ) : null}
              {hardwareItems.length ? (
                <DeliveryTable title="配件库配货" items={hardwareItems} />
              ) : null}
            </>
          ) : (
            <div className="empty">
              配货结果全部来源于“配货档案”，请填写颜色和数量后生成。
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function DeliveryTable({ title, items, length = false }) {
  return (
    <section className="delivery-group">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>图片 / 物品名称</th>
            <th>分类 / 材质</th>
            <th>颜色</th>
            {length ? <th>单包长度</th> : <th>规格</th>}
            <th>单包数量</th>
            <th>配货总数</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.groupKey || `${item.id}-${item.planColor}`}>
              <td>
                <span className="material-with-image">
                  <ImageThumb
                    src={item.material_image_url}
                    alt={item.material_name}
                    fallback="材"
                  />
                  <b>{item.material_name}</b>
                </span>
              </td>
              <td>{item.material_category || "—"}</td>
              <td>
                {item.materialColor}
                {item.sourcePlanColors?.length > 1 && (
                  <small>合并订单色：{item.sourcePlanColors.join("、")}</small>
                )}
              </td>
              <td>
                {length
                  ? `${item.cutting_length_cm} cm`
                  : item.material_specification || item.description || "—"}
              </td>
              <td>
                {item.quantity_per_product} {item.unit}
              </td>
              <td className="required">
                {length ? (
                  <>
                    {item.totalPieces} {item.unit} / {item.totalLengthM} m
                    {item.rollCount ? ` / ${item.rollCount} 卷` : ""}
                  </>
                ) : (
                  `${item.totalPieces} ${item.unit}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function DeliveryOrderDetail({ order, onClose }) {
  const groups = ["布料库", "长度材料库", "五金配件库"];
  return (
    <div className="modal-shade">
      <section className="modal detail delivery-order-detail">
        <div className="modal-head">
          <div>
            <p>DELIVERY LIST SNAPSHOT</p>
            <h2>{order.order_no}</h2>
          </div>
          <span className="maintenance-actions">
            <button type="button" onClick={() => exportDeliveryOrderCsv(order)}>
              导出 CSV
            </button>
            <button type="button" onClick={() => window.print()}>
              打印
            </button>
            <button type="button" aria-label="关闭清单" onClick={onClose}>
              ×
            </button>
          </span>
        </div>
        <div className="order-summary">
          <article>
            <small>产品</small>
            <b>
              {order.product_sku} · {order.product_name}
            </b>
          </article>
          <article>
            <small>颜色计划</small>
            <b>
              {order.colors
                .map((item) => `${item.product_color} ${item.quantity}件`)
                .join("、")}
            </b>
          </article>
          <article>
            <small>状态</small>
            <Status value={order.status} />
          </article>
          <article>
            <small>保存时间</small>
            <b>{formatDate(order.created_at)}</b>
          </article>
        </div>
        {groups.map((group) => {
          const items = order.items.filter(
            (item) => item.library_type === group,
          );
          return items.length ? (
            <section className="delivery-group" key={group}>
              <h3>
                {group === "长度材料库"
                  ? "线材库"
                  : group === "五金配件库"
                    ? "配件库"
                    : group}
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>材料</th>
                    <th>颜色 / 规格</th>
                    <th>配货数量</th>
                    <th>价格快照</th>
                    <th>材料成本</th>
                    <th>计算说明</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <b>{item.material_name}</b>
                        <small>{item.material_code}</small>
                        {item.cuttingPlans?.[0] && (
                          <small>
                            下料：{item.cuttingPlans[0].name} ·{" "}
                            {item.cuttingPlans[0].cutting_mode}
                          </small>
                        )}
                      </td>
                      <td>
                        {item.material_color || "—"}
                        <small>{item.material_specification || "—"}</small>
                      </td>
                      <td className="required">
                        {item.required_quantity}{" "}
                        {item.library_type === "五金配件库" ? item.unit : "m"}
                      </td>
                      <td>
                        {item.unit_price
                          ? `${formatMoney(item.unit_price)} ${item.price_unit || ""}`
                          : "未填写"}
                      </td>
                      <td>
                        {item.material_cost == null
                          ? "待核价"
                          : formatMoney(item.material_cost)}
                      </td>
                      <td>
                        <small>{item.calculation_detail}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null;
        })}
        <div className="cost-total">
          <span>材料成本</span>
          <strong>{formatMoney(order.material_cost)}</strong>
          <span>总成本</span>
          <strong>{formatMoney(order.total_cost)}</strong>
        </div>
      </section>
    </div>
  );
}

function DeliveryHistory() {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(null);
  const { data, error, reload } = useRequest(
    `/delivery-orders?keyword=${encodeURIComponent(keyword)}&status=${encodeURIComponent(status)}`,
  );
  const open = async (id) => {
    try {
      setSelected(await api(`/delivery-orders/${id}`));
    } catch (reason) {
      window.alert(reason.message);
    }
  };
  const changeStatus = async (order, nextStatus) => {
    try {
      await api(`/delivery-orders/${order.id}/status`, {
        method: "PUT",
        body: JSON.stringify({ status: nextStatus }),
      });
      reload();
      if (selected?.id === order.id)
        setSelected(await api(`/delivery-orders/${order.id}`));
    } catch (reason) {
      window.alert(reason.message);
    }
  };
  const remove = async (order) => {
    if (!window.confirm(`确认删除配货清单「${order.order_no}」吗？`)) return;
    try {
      await api(`/delivery-orders/${order.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      window.alert(reason.message);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <Header title="配货清单历史" subtitle="DELIVERY LIST / HISTORY" />
      <section className="panel">
        <div className="toolbar">
          <div className="history-filters">
            <div className="search">
              ⌕
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索清单编号、货号或产品名称"
              />
            </div>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">全部状态</option>
              {["草稿", "已确认", "已领料", "已完成", "已作废"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <span>共 {data.length} 张清单</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>清单编号</th>
              <th>产品</th>
              <th>生产数量</th>
              <th>材料项</th>
              <th>状态</th>
              <th>成本</th>
              <th>保存时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((order) => (
              <tr key={order.id}>
                <td>
                  <b>{order.order_no}</b>
                </td>
                <td>
                  {order.product_sku}
                  <small>{order.product_name}</small>
                </td>
                <td>{order.production_quantity} 件</td>
                <td>{order.item_count} 项</td>
                <td>
                  <select
                    className="status-select"
                    value={order.status}
                    onChange={(event) =>
                      changeStatus(order, event.target.value)
                    }
                  >
                    {["草稿", "已确认", "已领料", "已完成", "已作废"].map(
                      (item) => (
                        <option key={item}>{item}</option>
                      ),
                    )}
                  </select>
                </td>
                <td>{formatMoney(order.total_cost)}</td>
                <td>{formatDate(order.created_at)}</td>
                <td className="actions">
                  <button onClick={() => open(order.id)}>查看清单</button>
                  {["草稿", "已作废"].includes(order.status) && (
                    <button className="danger" onClick={() => remove(order)}>
                      删除
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && (
          <div className="empty">
            尚未保存配货清单，请先在 BOM 配货计算页面生成并保存。
          </div>
        )}
      </section>
      {selected && (
        <DeliveryOrderDetail
          order={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function DeliveryCost() {
  const { data: orders, error, reload } = useRequest("/delivery-orders");
  const [orderId, setOrderId] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    lossRate: 0,
    laborUnitCost: 0,
    packagingUnitCost: 0,
    cuttingCost: 0,
    deliveryCost: 0,
    otherCost: 0,
  });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (orders?.[0] && !orderId) setOrderId(String(orders[0].id));
  }, [orders, orderId]);
  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    api(`/delivery-orders/${orderId}`)
      .then((order) => {
        setDetail(order);
        setForm({
          lossRate: order.loss_rate || 0,
          laborUnitCost: order.labor_unit_cost || 0,
          packagingUnitCost: order.packaging_unit_cost || 0,
          cuttingCost: order.cutting_cost || 0,
          deliveryCost: order.delivery_cost || 0,
          otherCost: order.other_cost || 0,
        });
        setMessage("");
      })
      .catch((reason) => setMessage(reason.message));
  }, [orderId]);
  const updatePrice = (id, value) =>
    setDetail((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id ? { ...item, unit_price: value } : item,
      ),
    }));
  const save = async (useCurrentPrices = false) => {
    try {
      const updated = await api(`/delivery-orders/${orderId}/cost`, {
        method: "PUT",
        body: JSON.stringify({
          ...form,
          useCurrentPrices,
          items: detail.items.map((item) => ({
            id: item.id,
            unitPrice: item.unit_price,
          })),
        }),
      });
      setDetail(updated);
      setMessage(
        useCurrentPrices ? "已读取原料库最新价格并完成核算" : "成本核算已保存",
      );
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!orders) return <LoadingState />;
  const missing =
    detail?.items.filter((item) => !(Number(item.unit_price) > 0)) || [];
  const singlePackageCost = detail?.production_quantity
    ? Number(detail.total_cost) / Number(detail.production_quantity)
    : 0;
  const processingCost =
    Number(detail?.labor_cost || 0) +
    Number(detail?.packaging_cost || 0) +
    Number(detail?.cutting_cost || 0);
  const batchCost =
    Number(detail?.delivery_cost || 0) + Number(detail?.other_cost || 0);
  return (
    <>
      <Header title="配货成本核算" subtitle="DELIVERY LIST / COST" />
      <section className="cost-layout">
        <div className="panel cost-controls">
          <p>选择历史清单</p>
          <label>
            配货清单
            <select
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
            >
              <option value="">请选择</option>
              {orders.map((order) => (
                <option value={order.id} key={order.id}>
                  {order.order_no} · {order.product_sku} ·{" "}
                  {order.production_quantity}件
                </option>
              ))}
            </select>
          </label>
          {detail && (
            <>
              <div className="cost-form-grid">
                {[
                  ["lossRate", "材料损耗率（%）"],
                  ["laborUnitCost", "单包人工工价（元）"],
                  ["packagingUnitCost", "单包包装费（元）"],
                  ["cuttingCost", "整批裁剪费（元）"],
                  ["deliveryCost", "整批配货费（元）"],
                  ["otherCost", "整批其他费用（元）"],
                ].map(([field, label]) => (
                  <label key={field}>
                    {label}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={form[field]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [field]: event.target.value,
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="cost-formula">
                人工费与包装费按生产数量自动放大；裁剪费、配货费和其他费用按整批计入。
              </div>
              <button onClick={() => save(true)}>读取原料库最新价格</button>
              <button className="primary big" onClick={() => save(false)}>
                保存成本核算
              </button>
            </>
          )}
          {message && <p className="notice neutral">{message}</p>}
        </div>
        <div className="panel cost-result">
          {detail ? (
            <>
              <div className="section-title">
                <div>
                  <p>COST SNAPSHOT</p>
                  <h2>{detail.order_no}</h2>
                </div>
                <b>
                  {detail.product_sku} · {detail.production_quantity} 件
                </b>
              </div>
              {missing.length > 0 && (
                <p className="notice">
                  仍有 {missing.length}{" "}
                  项材料未填写价格，请在下表直接补充，或返回原料库维护价格。
                </p>
              )}
              <table>
                <thead>
                  <tr>
                    <th>材料</th>
                    <th>库别 / 颜色</th>
                    <th>配货数量</th>
                    <th>计价单位</th>
                    <th>单价</th>
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => (
                    <tr
                      className={
                        Number(item.unit_price) > 0 ? "" : "missing-price"
                      }
                      key={item.id}
                    >
                      <td>
                        <b>{item.material_name}</b>
                        <small>{item.material_specification || "—"}</small>
                      </td>
                      <td>
                        {item.library_type}
                        <small>{item.material_color || "—"}</small>
                      </td>
                      <td>
                        {item.required_quantity}{" "}
                        {item.library_type === "五金配件库" ? item.unit : "m"}
                      </td>
                      <td>{item.price_unit || "按配货单位"}</td>
                      <td>
                        <input
                          className="price-input"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price || ""}
                          onChange={(event) =>
                            updatePrice(item.id, event.target.value)
                          }
                          placeholder="填写单价"
                        />
                      </td>
                      <td>
                        {Number(item.unit_price) > 0
                          ? formatMoney(
                              Number(item.required_quantity) *
                                Number(item.unit_price),
                            )
                          : "待核价"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cost-breakdown">
                <span>
                  人工：{formatMoney(detail.labor_unit_cost)} ×{" "}
                  {detail.production_quantity}件 ={" "}
                  <b>{formatMoney(detail.labor_cost)}</b>
                </span>
                <span>
                  包装：{formatMoney(detail.packaging_unit_cost)} ×{" "}
                  {detail.production_quantity}件 ={" "}
                  <b>{formatMoney(detail.packaging_cost)}</b>
                </span>
                <span>
                  整批裁剪费：<b>{formatMoney(detail.cutting_cost)}</b>
                </span>
                <span>
                  整批配货费：<b>{formatMoney(detail.delivery_cost)}</b>
                </span>
                <span>
                  整批其他费用：<b>{formatMoney(detail.other_cost)}</b>
                </span>
              </div>
              <div className="cost-cards">
                <article>
                  <small>材料成本</small>
                  <strong>{formatMoney(detail.material_cost)}</strong>
                </article>
                <article>
                  <small>损耗成本</small>
                  <strong>{formatMoney(detail.loss_cost)}</strong>
                </article>
                <article>
                  <small>加工费用</small>
                  <strong>{formatMoney(processingCost)}</strong>
                </article>
                <article>
                  <small>整批附加费用</small>
                  <strong>{formatMoney(batchCost)}</strong>
                </article>
                <article className="grand-total">
                  <small>配货总成本</small>
                  <strong>{formatMoney(detail.total_cost)}</strong>
                </article>
                <article className="unit-total">
                  <small>单包成本</small>
                  <strong>{formatMoney(singlePackageCost)}</strong>
                  <span>总成本 ÷ {detail.production_quantity} 件</span>
                </article>
              </div>
            </>
          ) : (
            <div className="empty">保存 BOM 配货清单后，即可进行成本核算。</div>
          )}
        </div>
      </section>
    </>
  );
}

function PartsLibrary() {
  const { data: products } = useRequest("/products");
  const { data: materials } = useRequest("/materials");
  const { data: molds } = useRequest("/molds");
  const [productId, setProductId] = useState("");
  const [parts, setParts] = useState([]);
  const [form, setForm] = useState(null);
  const [partImageUploading, setPartImageUploading] = useState(false);
  const load = () =>
    productId && api(`/products/${productId}/parts`).then(setParts);
  useEffect(() => {
    if (products?.[0] && !productId) setProductId(String(products[0].id));
  }, [products, productId]);
  useEffect(() => {
    load();
  }, [productId]);
  const save = async (e) => {
    e.preventDefault();
    await api(
      form.id ? `/cutting-parts/${form.id}` : `/products/${productId}/parts`,
      { method: form.id ? "PUT" : "POST", body: JSON.stringify(form) },
    );
    setForm(null);
    load();
  };
  const uploadPartImage = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      window.alert("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      window.alert("裁片图片不能超过 30MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setPartImageUploading(true);
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        setForm((current) => ({ ...current, image_url: image.url }));
      } catch (reason) {
        window.alert(reason.message);
      } finally {
        setPartImageUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  if (!products || !materials || !molds) return <LoadingState />;
  const fabrics = materials.filter((m) =>
    ["面布", "里布", "夹层", "支撑板", "复合布", "其它", "布料"].includes(
      m.category_name,
    ),
  );
  return (
    <>
      <Header
        title="裁片资料维护"
        subtitle="CUTTING PARTS / PRODUCT LINK"
        action={
          <button
            className="primary"
            onClick={() =>
              setForm({
                material_id: "",
                mold_id: "",
                name: "",
                max_length_cm: "",
                max_width_cm: "",
                quantity_per_product: 1,
                image_url: "",
                notes: "",
              })
            }
          >
            + 新增裁片
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <label>
            产品
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <table>
          <thead>
            <tr>
              <th>裁片</th>
              <th>布料</th>
              <th>尺寸</th>
              <th>片数</th>
              <th>刀模</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="part-with-image">
                    <ImageThumb src={p.image_url} alt={p.name} fallback="裁" />
                    <span>
                      <b>{p.name}</b>
                      <small>{p.code}</small>
                    </span>
                  </span>
                </td>
                <td>{p.material_name}</td>
                <td>
                  {p.max_length_cm} × {p.max_width_cm} cm
                </td>
                <td>{p.quantity_per_product}</td>
                <td>{p.mold_code || "手工裁剪"}</td>
                <td className="actions">
                  <button onClick={() => setForm(p)}>编辑</button>
                  <button
                    className="danger"
                    onClick={async () => {
                      await api(`/cutting-parts/${p.id}`, { method: "DELETE" });
                      load();
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {form && (
        <div className="modal-shade">
          <form className="modal material-form" onSubmit={save}>
            <div className="modal-head">
              <h2>裁片资料</h2>
              <button type="button" onClick={() => setForm(null)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                布料
                <select
                  value={form.material_id || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, material_id: e.target.value }))
                  }
                  required
                >
                  <option value="">请选择</option>
                  {fabrics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} · {m.color || "无颜色"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                裁片名称
                <input
                  value={form.name || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, name: e.target.value }))
                  }
                  required
                />
              </label>
              <label>
                最大长度 cm
                <input
                  type="number"
                  value={form.max_length_cm || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, max_length_cm: e.target.value }))
                  }
                />
              </label>
              <label>
                最大宽度 cm
                <input
                  type="number"
                  value={form.max_width_cm || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, max_width_cm: e.target.value }))
                  }
                />
              </label>
              <label>
                片数
                <input
                  type="number"
                  value={form.quantity_per_product || ""}
                  onChange={(e) =>
                    setForm((v) => ({
                      ...v,
                      quantity_per_product: e.target.value,
                    }))
                  }
                />
              </label>
              <label>
                刀模
                <select
                  value={form.mold_id || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, mold_id: e.target.value }))
                  }
                >
                  <option value="">手工裁剪</option>
                  {molds.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                裁片图片
                <ImageUploadDropZone
                  src={form.image_url}
                  alt="裁片图片预览"
                  actionText="+ 上传裁片图片"
                  uploading={partImageUploading}
                  onFile={uploadPartImage}
                />
              </label>
              <label className="full">
                备注
                <textarea
                  value={form.notes || ""}
                  onChange={(e) =>
                    setForm((v) => ({ ...v, notes: e.target.value }))
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setForm(null)}>
                取消
              </button>
              <button className="primary" disabled={partImageUploading}>
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
function LibraryAccessoriesEditor({ value, materials, onChange }) {
  const update = (index, field, fieldValue) =>
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: fieldValue } : item,
      ),
    );
  const selectable = materials.filter(
    (item) =>
      !["面布", "里布", "夹层", "支撑板", "复合布", "其它", "布料"].includes(
        item.category_name,
      ),
  );
  return (
    <section className="editor-block">
      <div className="block-title">
        <div>
          <b>配件资料</b>
          <small>
            只能选择长度材料库或五金配件库中的已有项目；未选择则不保存。
          </small>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, emptyAccessory()])}
        >
          + 添加配件
        </button>
      </div>
      {value.map((item, index) => {
        const selected = materials.find(
          (material) => String(material.id) === String(item.material_id),
        );
        return (
          <div className="accessory-row" key={index}>
            <select
              value={item.material_id || ""}
              onChange={(event) =>
                update(index, "material_id", event.target.value)
              }
            >
              <option value="">请选择库内配件</option>
              {selectable.map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.color || "无颜色"}
                </option>
              ))}
            </select>
            <span>{selected?.category_name || "—"}</span>
            <span>{selected?.specification || "—"}</span>
            <input
              style={{ minWidth: 110 }}
              type="number"
              min="0"
              step="any"
              value={item.quantity || ""}
              onChange={(event) =>
                update(index, "quantity", event.target.value)
              }
              placeholder="数量"
            />
            <input
              value={item.notes || ""}
              onChange={(event) => update(index, "notes", event.target.value)}
              placeholder="备注说明"
            />
            <button
              type="button"
              className="danger"
              onClick={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
            >
              移除
            </button>
          </div>
        );
      })}
    </section>
  );
}
function PartsEditor({ value, materials, molds, onChange }) {
  const update = (index, field, fieldValue) =>
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: fieldValue } : item,
      ),
    );
  const add = () =>
    onChange([
      ...value,
      {
        material_id: "",
        mold_id: "",
        name: "",
        max_length_cm: "",
        max_width_cm: "",
        quantity_per_product: 1,
        notes: "",
      },
    ]);
  return (
    <section className="editor-block">
      <div className="block-title">
        <div>
          <b>裁片资料</b>
          <small>裁片可新增、修改、删除；材料和刀模均从基础库调用。</small>
        </div>
        <button type="button" onClick={add}>
          + 添加裁片
        </button>
      </div>
      {value.map((item, index) => (
        <div className="accessory-row" key={index}>
          <select
            value={item.material_id || ""}
            onChange={(event) =>
              update(index, "material_id", event.target.value)
            }
          >
            <option value="">选择布料</option>
            {materials
              .filter((material) =>
                [
                  "面布",
                  "里布",
                  "夹层",
                  "支撑板",
                  "复合布",
                  "其它",
                  "布料",
                ].includes(material.category_name),
              )
              .map((material) => (
                <option key={material.id} value={material.id}>
                  {material.name} · {material.color || "无颜色"}
                </option>
              ))}
          </select>
          <input
            value={item.name || ""}
            onChange={(event) => update(index, "name", event.target.value)}
            placeholder="裁片名称"
          />
          <input
            type="number"
            min="0"
            value={item.max_length_cm || ""}
            onChange={(event) =>
              update(index, "max_length_cm", event.target.value)
            }
            placeholder="长度 cm"
          />
          <input
            type="number"
            min="0"
            value={item.max_width_cm || ""}
            onChange={(event) =>
              update(index, "max_width_cm", event.target.value)
            }
            placeholder="宽度 cm"
          />
          <input
            type="number"
            min="1"
            value={item.quantity_per_product || ""}
            onChange={(event) =>
              update(index, "quantity_per_product", event.target.value)
            }
            placeholder="片数"
          />
          <select
            value={item.mold_id || ""}
            onChange={(event) => update(index, "mold_id", event.target.value)}
          >
            <option value="">手工裁剪</option>
            {molds.map((mold) => (
              <option key={mold.id} value={mold.id}>
                {mold.code}
              </option>
            ))}
          </select>
          <input
            value={item.notes || ""}
            onChange={(event) => update(index, "notes", event.target.value)}
            placeholder="备注"
          />
          <button
            type="button"
            className="danger"
            onClick={() =>
              onChange(value.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            移除
          </button>
        </div>
      ))}
    </section>
  );
}
function AccessoriesLibrary() {
  const { data: products } = useRequest("/products");
  const [productId, setProductId] = useState("");
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (products?.[0] && !productId) setProductId(String(products[0].id));
  }, [products, productId]);
  useEffect(() => {
    if (productId) api(`/products/${productId}/accessories`).then(setRows);
  }, [productId]);
  if (!products) return <LoadingState />;
  return (
    <>
      <Header title="配件资料维护" subtitle="ACCESSORIES / LIBRARY LINK" />
      <section className="panel">
        <div className="toolbar">
          <label>
            产品
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <span>配件从长度材料库、五金配件库调用</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>材质</th>
              <th>规格</th>
              <th>数量</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.material || "—"}</td>
                <td>{r.specification || "—"}</td>
                <td>
                  {r.quantity ?? "—"} {r.unit || ""}
                </td>
                <td>{r.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
function MaterialLibrary({ title, libraryType, categories }) {
  const { data, error, reload } = useRequest("/materials");
  const [editing, setEditing] = useState(undefined);
  const [keyword, setKeyword] = useState("");
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-CN");
  const rows = (
    data?.filter((item) => categories.includes(item.category_name)) || []
  ).filter(
    (item) =>
      !normalizedKeyword ||
      [
        item.name,
        item.code,
        item.specification,
        item.supplier,
        item.category_name,
        item.notes,
      ].some((value) =>
        String(value || "")
          .toLocaleLowerCase("zh-CN")
          .includes(normalizedKeyword),
      ),
  );
  const remove = async (item) => {
    if (!window.confirm(`确认删除「${item.name}」吗？`)) return;
    try {
      await api(`/materials/${item.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      window.alert(`无法删除：${reason.message}`);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data) return <LoadingState />;
  const columns =
    libraryType === "fabric"
      ? [
          "图片",
          "名称",
          "规格",
          "有效幅宽",
          "每米单价",
          "供应商",
          "类别",
          "备注",
        ]
      : libraryType === "length"
        ? [
            "图片",
            "名称",
            "规格尺寸",
            "每卷长度",
            "每米单价",
            "每卷价格",
            "供应商",
            "备注",
          ]
        : ["图片", "名称", "规格尺寸", "重量", "单价", "供应商", "备注"];
  const cellValues = (item) =>
    libraryType === "fabric"
      ? [
          item.image_thumbnail_url || item.image_url,
          item.name,
          item.specification || "—",
          item.width_cm ? `${item.width_cm} cm` : "—",
          item.unit_price == null ? "—" : `¥${item.unit_price}`,
          item.supplier || "—",
          item.category_name || "—",
          item.notes || "—",
        ]
      : libraryType === "length"
        ? [
            item.image_thumbnail_url || item.image_url,
            item.name,
            item.specification || "—",
            item.roll_length_cm ? `${item.roll_length_cm} cm` : "—",
            item.unit_price == null ? "—" : `¥${item.unit_price}`,
            item.roll_price == null ? "—" : `¥${item.roll_price}`,
            item.supplier || "—",
            item.notes || "—",
          ]
        : [
            item.image_thumbnail_url || item.image_url,
            item.name,
            item.specification || "—",
            item.weight_gsm ? `${item.weight_gsm} g` : "—",
            item.unit_price == null ? "—" : `¥${item.unit_price}`,
            item.supplier || "—",
            item.notes || "—",
          ];
  return (
    <div>
      <Header
        title={title}
        subtitle="BASE MATERIAL LIBRARY"
        action={
          <button
            className="primary"
            onClick={() =>
              setEditing({ ...emptyMaterial, category_name: categories[0] })
            }
          >
            + 新增材料
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            ⌕
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称、编号、规格、供应商或备注"
            />
          </div>
          <span>共 {rows.length} 条，可关联产品、下料方案与配货规则</span>
        </div>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                {cellValues(item).map((value, index) => (
                  <td
                    className={index === columns.length - 1 ? "note-cell" : ""}
                    key={index}
                  >
                    {index === 0 ? (
                      value ? (
                        <img
                          src={value}
                          alt={item.name}
                          style={{
                            width: 48,
                            height: 48,
                            objectFit: "cover",
                            borderRadius: 7,
                          }}
                        />
                      ) : (
                        <small>暂无图片</small>
                      )
                    ) : columns[index]?.includes("单价") &&
                      String(item.latest_price_notes || "").includes("临时") ? (
                      <span className="price-status">
                        <b>{value}</b>
                        <small>暂定价</small>
                      </span>
                    ) : (
                      value
                    )}
                  </td>
                ))}
                <td className="actions">
                  <button onClick={() => setEditing(item)}>编辑</button>
                  <button className="danger" onClick={() => remove(item)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="empty">没有找到符合条件的材料</div>
        )}
      </section>
      {editing !== undefined && (
        <LibraryMaterialForm
          material={editing}
          libraryType={libraryType}
          categories={categories}
          onClose={() => setEditing(undefined)}
          onSave={() => {
            setEditing(undefined);
            reload();
          }}
        />
      )}
    </div>
  );
}

function LegacyLibraryMaterialForm({
  material,
  libraryType,
  categories,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState(material);
  const [colors, setColors] = useState([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  useEffect(() => {
    api("/meta/colors")
      .then(setColors)
      .catch((reason) => setError(reason.message));
  }, []);
  const addColor = async () => {
    const name = window.prompt("请输入颜色名称");
    if (!name?.trim()) return;
    const color = await api("/meta/colors", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setColors((items) => [...items, color]);
    set("color", color.name);
  };
  const upload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        set("image_url", image.url);
      } catch (reason) {
        setError(reason.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(material.id ? `/materials/${material.id}` : "/materials", {
        method: material.id ? "PUT" : "POST",
        body: JSON.stringify(form),
      });
      onSave();
    } catch (reason) {
      setError(reason.message);
    }
  };
  const fields =
    libraryType === "fabric"
      ? [
          ["specification", "规格"],
          ["width_cm", "有效幅宽（cm）"],
          ["supplier", "供应商"],
        ]
      : libraryType === "length"
        ? [
            ["specification", "规格尺寸"],
            ["roll_length_cm", "每卷长度（cm）"],
            ["unit_price", "每米单价（元）"],
            ["supplier", "供应商"],
          ]
        : [
            ["specification", "规格尺寸"],
            ["weight_gsm", "重量（g）"],
            ["unit_price", "单价（元）"],
            ["supplier", "供应商"],
          ];
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>{libraryType.toUpperCase()} LIBRARY</p>
            <h2>{material.id ? "编辑材料" : "新增材料"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-grid">
          <label>
            名称
            <input
              value={form.name || ""}
              onChange={(event) => set("name", event.target.value)}
              required
            />
          </label>
          <label>
            颜色
            <span className="field-with-button">
              <input
                list="library-colors"
                value={form.color || ""}
                onChange={(event) => set("color", event.target.value)}
              />
              <datalist id="library-colors">
                {colors.map((color) => (
                  <option value={color.name} key={color.id} />
                ))}
              </datalist>
              <button type="button" onClick={addColor}>
                新增
              </button>
            </span>
          </label>
          {fields.map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type={
                  [
                    "width_cm",
                    "roll_length_cm",
                    "unit_price",
                    "weight_gsm",
                  ].includes(field)
                    ? "number"
                    : "text"
                }
                min="0"
                step="any"
                value={form[field] || ""}
                onChange={(event) => set(field, event.target.value)}
              />
            </label>
          ))}
          {libraryType === "fabric" && (
            <label>
              类别
              <select
                value={form.category_name || "面布"}
                onChange={(event) => set("category_name", event.target.value)}
              >
                {categories
                  .filter((name) => !["布料"].includes(name))
                  .map((name) => (
                    <option key={name}>{name}</option>
                  ))}
              </select>
            </label>
          )}
          <label className="full">
            图片
            <ImageUploadDropZone
              src={form.image_url}
              alt="材料预览"
              actionText="选择并上传图片"
              uploading={uploading}
              onFile={upload}
            />
          </label>
          <label className="full">
            备注
            <textarea
              value={form.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={uploading}>
            保存材料
          </button>
        </div>
      </form>
    </div>
  );
}

function LibraryMaterialForm({
  material,
  libraryType,
  categories,
  onClose,
  onSave,
}) {
  const [form, setForm] = useState({ ...material, color: "" });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [priceHistory, setPriceHistory] = useState([]);
  useEffect(() => {
    if (material.id)
      api(`/materials/${material.id}/prices`)
        .then(setPriceHistory)
        .catch((reason) => setError(reason.message));
  }, [material.id]);
  const set = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const upload = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setError("材料图片不能超过 30MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        setError("");
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        setForm((current) => ({
          ...current,
          image_url: image.url,
          image_thumbnail_url: image.thumbnailUrl,
          image_mime_type: file.type,
          image_file_size: file.size,
        }));
      } catch (reason) {
        setError(reason.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(material.id ? `/materials/${material.id}` : "/materials", {
        method: material.id ? "PUT" : "POST",
        body: JSON.stringify({ ...form, color: "" }),
      });
      onSave();
    } catch (reason) {
      setError(reason.message);
    }
  };
  const confirmPrice = async () => {
    try {
      setPriceHistory(
        await api(`/materials/${material.id}/prices/confirm`, {
          method: "POST",
        }),
      );
      setError("");
    } catch (reason) {
      setError(reason.message);
    }
  };
  const fields =
    libraryType === "fabric"
      ? [
          ["specification", "规格"],
          ["width_cm", "有效幅宽（cm）"],
          ["unit_price", "每米单价（元）"],
          ["supplier", "供应商"],
        ]
      : libraryType === "length"
        ? [
            ["specification", "规格尺寸"],
            ["roll_length_cm", "每卷长度（cm）"],
            ["unit_price", "每米单价（元）"],
            ["roll_price", "每卷价格（元）"],
            ["supplier", "供应商"],
          ]
        : [
            ["specification", "规格尺寸"],
            ["weight_gsm", "重量（g）"],
            ["unit_price", "单价（元）"],
            ["supplier", "供应商"],
          ];
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p>{libraryType.toUpperCase()} LIBRARY</p>
            <h2>{material.id ? "编辑材料主体" : "新增材料主体"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="notice neutral">
          这里只维护名称、规格、尺寸、价格等主体资料；颜色在产品调用时单独选择。价格更新后会自动保留历史记录。
        </div>
        <div className="form-grid">
          <label>
            名称
            <input
              value={form.name || ""}
              onChange={(event) => set("name", event.target.value)}
              required
            />
          </label>
          {fields.map(([field, label]) => (
            <label key={field}>
              {label}
              <input
                type={
                  [
                    "width_cm",
                    "roll_length_cm",
                    "unit_price",
                    "roll_price",
                    "weight_gsm",
                  ].includes(field)
                    ? "number"
                    : "text"
                }
                min="0"
                step="any"
                value={form[field] || ""}
                onChange={(event) => set(field, event.target.value)}
              />
            </label>
          ))}
          {libraryType === "fabric" && (
            <label>
              类别
              <select
                value={form.category_name || "面布"}
                onChange={(event) => set("category_name", event.target.value)}
              >
                {categories
                  .filter((name) => name !== "布料")
                  .map((name) => (
                    <option key={name}>{name}</option>
                  ))}
              </select>
            </label>
          )}
          <label>
            计价单位
            <select
              value={form.price_unit || ""}
              onChange={(event) => set("price_unit", event.target.value)}
            >
              <option value="">系统自动判断</option>
              {libraryType === "hardware" ? (
                ["元/个", "元/对", "元/套"].map((item) => (
                  <option key={item}>{item}</option>
                ))
              ) : (
                <option>元/米</option>
              )}
            </select>
          </label>
          <label className="full">
            图片
            <ImageUploadDropZone
              src={form.image_url}
              alt="材料预览"
              actionText="选择并上传图片（最大30MB）"
              uploading={uploading}
              onFile={upload}
            />
          </label>
          <label className="full">
            备注
            <textarea
              value={form.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>
        {material.id && (
          <section className="price-history">
            <div className="block-title">
              <div>
                <b>价格历史</b>
                <small>暂定价确认后，成本核算可继续使用价格快照。</small>
              </div>
              <button type="button" onClick={confirmPrice}>
                确认当前价格
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>生效日期</th>
                  <th>供应商</th>
                  <th>价格</th>
                  <th>计价单位</th>
                  <th>状态说明</th>
                </tr>
              </thead>
              <tbody>
                {priceHistory.map((price) => (
                  <tr key={price.id}>
                    <td>{price.effective_date}</td>
                    <td>{price.supplier || "—"}</td>
                    <td>{formatMoney(price.price)}</td>
                    <td>{price.price_unit}</td>
                    <td>{price.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!priceHistory.length && <div className="empty">暂无价格历史</div>}
          </section>
        )}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={uploading}>
            保存材料主体
          </button>
        </div>
      </form>
    </div>
  );
}

const emptyMold = {
  product_id: "",
  cutting_part_id: "",
  image_url: "",
  storage_location: "",
  notes: "",
};
function MoldForm({ value, setValue, products, onSubmit, onClose }) {
  const [parts, setParts] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const selectedPart = parts.find(
    (item) => String(item.id) === String(value.cutting_part_id),
  );
  const selectedProduct = products.find(
    (item) => String(item.id) === String(value.product_id),
  );
  const code = selectedPart
    ? `DM-${selectedPart.code}`
    : value.code || "选择裁片后自动生成";
  const name =
    selectedPart && selectedProduct
      ? `${selectedProduct.sku} ${selectedPart.name}`
      : value.name || "选择裁片后自动生成";
  useEffect(() => {
    if (!value.product_id) {
      setParts([]);
      return;
    }
    api(`/products/${value.product_id}/parts`)
      .then(setParts)
      .catch((reason) => setError(reason.message));
  }, [value.product_id]);
  const set = (field, fieldValue) =>
    setValue((current) => ({ ...current, [field]: fieldValue }));
  const chooseProduct = (productId) =>
    setValue((current) => ({
      ...current,
      product_id: productId,
      cutting_part_id: "",
      code: "",
      name: "",
    }));
  const upload = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setError("图片不能超过 30MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        setError("");
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        setValue((current) => ({
          ...current,
          image_url: image.url,
          image_thumbnail_url: image.thumbnailUrl,
          image_mime_type: file.type,
          image_file_size: file.size,
        }));
      } catch (reason) {
        setError(reason.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  return (
    <div className="modal-shade">
      <form className="modal material-form" onSubmit={onSubmit}>
        <div className="modal-head">
          <div>
            <p>MOLD / CUTTING PART</p>
            <h2>{value.id ? "编辑刀模" : "新增刀模"}</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-grid">
          <label>
            关联产品
            <SearchableSelect
              value={value.product_id || ""}
              onChange={chooseProduct}
              required
              ariaLabel="搜索并选择关联产品"
              placeholder="输入货号或产品名称搜索"
              options={products.map((product) => ({
                value: product.id,
                label: `${product.sku} · ${product.name}`,
              }))}
            />
          </label>
          <label>
            关联裁片
            <SearchableSelect
              value={value.cutting_part_id || ""}
              onChange={(partId) => set("cutting_part_id", partId)}
              required
              disabled={!value.product_id}
              ariaLabel="搜索并选择关联裁片"
              placeholder="输入裁片编号或名称搜索"
              options={parts
                .filter(
                  (part) =>
                    !part.mold_id || Number(part.mold_id) === Number(value.id),
                )
                .map((part) => ({
                  value: part.id,
                  label: `${part.code} · ${part.name}`,
                }))}
            />
          </label>
          <label>
            刀模编号
            <input value={code} readOnly />
          </label>
          <label>
            刀模名称
            <input value={name} readOnly />
          </label>
          <label>
            存放库位
            <input
              value={value.storage_location || ""}
              onChange={(event) => set("storage_location", event.target.value)}
            />
          </label>
          <label>
            刀模图片
            <ImageUploadDropZone
              src={value.image_url}
              alt="刀模预览"
              actionText="+ 上传图片"
              uploading={uploading}
              onFile={upload}
            />
          </label>
          <label className="full">
            备注说明
            <textarea
              value={value.notes || ""}
              onChange={(event) => set("notes", event.target.value)}
            />
          </label>
        </div>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary">保存刀模</button>
        </div>
      </form>
    </div>
  );
}
function MoldLibrary() {
  const { data, error, reload } = useRequest("/molds");
  const { data: products } = useRequest("/products");
  const [editing, setEditing] = useState(undefined);
  const [message, setMessage] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setMessage("");
    try {
      await api(editing.id ? `/molds/${editing.id}` : "/molds", {
        method: editing.id ? "PUT" : "POST",
        body: JSON.stringify(editing),
      });
      setEditing(undefined);
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  const remove = async (item) => {
    if (!window.confirm(`确认删除刀模「${item.code}」吗？`)) return;
    try {
      await api(`/molds/${item.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data || !products) return <LoadingState />;
  return (
    <>
      <Header
        title="刀模库"
        subtitle="MOLD LIBRARY / CUTTING PART LINK"
        action={
          <button
            className="primary"
            onClick={() => setEditing({ ...emptyMold })}
          >
            + 新增刀模
          </button>
        }
      />
      {message && <div className="error">{message}</div>}
      <section className="panel">
        <table>
          <thead>
            <tr>
              <th>缩略图 / 编号</th>
              <th>自动名称</th>
              <th>关联产品</th>
              <th>关联裁片</th>
              <th>库位</th>
              <th>备注</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="mold-thumb">
                    {item.image_url ? (
                      <img src={item.image_url} alt="刀模缩略图" />
                    ) : (
                      <i>刀</i>
                    )}
                    <b>{item.code}</b>
                  </span>
                </td>
                <td>{item.name}</td>
                <td>{item.product_sku || "未关联"}</td>
                <td>
                  {item.cutting_part_name ? (
                    <>
                      <b>{item.cutting_part_name}</b>
                      <small>{item.cutting_part_code}</small>
                    </>
                  ) : (
                    "未关联裁片"
                  )}
                </td>
                <td>{item.storage_location || "—"}</td>
                <td className="note-cell">{item.notes || "—"}</td>
                <td className="actions">
                  <button onClick={() => setEditing(item)}>编辑</button>
                  <button className="danger" onClick={() => remove(item)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <MoldForm
          value={editing}
          setValue={setEditing}
          products={products}
          onSubmit={save}
          onClose={() => setEditing(undefined)}
        />
      )}
    </>
  );
}

const emptyCuttingPlan = {
  product_id: "",
  delivery_rule_id: "",
  name: "",
  image_url: "",
  cutting_mode: "手工裁剪",
  mold_ids: [],
  notes: "",
};
function CuttingPlanLibrary() {
  const { data, error, reload } = useRequest("/cutting-plans");
  const { data: products } = useRequest("/products");
  const { data: materials } = useRequest("/materials");
  const { data: molds } = useRequest("/molds");
  const [editing, setEditing] = useState(undefined);
  const save = async (event) => {
    event.preventDefault();
    await api(editing.id ? `/cutting-plans/${editing.id}` : "/cutting-plans", {
      method: editing.id ? "PUT" : "POST",
      body: JSON.stringify(editing),
    });
    setEditing(undefined);
    reload();
  };
  const remove = async (item) => {
    if (!window.confirm(`确认删除下料方案「${item.name}」吗？`)) return;
    await api(`/cutting-plans/${item.id}`, { method: "DELETE" });
    reload();
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data || !products || !materials || !molds) return <LoadingState />;
  return (
    <>
      <Header
        title="下料库"
        subtitle="CUTTING PLANS / FABRIC & MOLD"
        action={
          <button
            className="primary"
            onClick={() => setEditing({ ...emptyCuttingPlan })}
          >
            + 新增下料方案
          </button>
        }
      />
      <section className="panel">
        <div className="toolbar">
          <span>下料方案可关联产品、布料和刀模，并作为裁剪配货的基础数据</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>图片 / 方案</th>
              <th>产品</th>
              <th>布料</th>
              <th>单张包数</th>
              <th>拉布长度</th>
              <th>裁剪方式</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id}>
                <td className="mold-thumb">
                  {item.image_url ? (
                    <img src={item.image_url} alt="下料图" />
                  ) : (
                    <i>料</i>
                  )}
                  <b>{item.name}</b>
                  <small>{item.mold_code || "无刀模"}</small>
                </td>
                <td>{item.product_sku}</td>
                <td>
                  {item.material_name}
                  <small>{item.material_color || "—"}</small>
                </td>
                <td>{item.pieces_per_lay} 包</td>
                <td>{item.cutting_length_cm} cm</td>
                <td>{item.cutting_mode}</td>
                <td className="actions">
                  <button onClick={() => setEditing(item)}>编辑</button>
                  <button className="danger" onClick={() => remove(item)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <div className="modal-shade">
          <form className="modal material-form" onSubmit={save}>
            <div className="modal-head">
              <div>
                <p>CUTTING PLAN</p>
                <h2>{editing.id ? "编辑下料方案" : "新增下料方案"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(undefined)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                关联产品
                <select
                  value={editing.product_id || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      product_id: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">请选择产品</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                布料材料
                <select
                  value={editing.material_id || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      material_id: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">请选择布料</option>
                  {materials
                    .filter((item) =>
                      ["布料", "里布"].includes(item.category_name),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {item.color || "无颜色"}
                      </option>
                    ))}
                </select>
              </label>
              {[
                ["name", "方案名称"],
                ["image_url", "下料图链接"],
                ["pieces_per_lay", "单张包数"],
                ["cutting_length_cm", "拉布长度（cm）"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    type={
                      ["pieces_per_lay", "cutting_length_cm"].includes(field)
                        ? "number"
                        : "text"
                    }
                    min="0"
                    step="any"
                    value={editing[field] || ""}
                    onChange={(event) =>
                      setEditing((value) => ({
                        ...value,
                        [field]: event.target.value,
                      }))
                    }
                    required={field !== "image_url"}
                  />
                </label>
              ))}
              <label>
                关联刀模
                <select
                  value={editing.mold_id || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      mold_id: event.target.value,
                    }))
                  }
                >
                  <option value="">手工裁剪或暂不关联</option>
                  {molds.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} · {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                裁剪方式
                <select
                  value={editing.cutting_mode}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      cutting_mode: event.target.value,
                    }))
                  }
                >
                  {["刀模裁剪", "手工裁剪", "待确认"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="full">
                备注说明
                <textarea
                  value={editing.notes || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button className="primary">保存方案</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function CuttingPlanLibraryV2() {
  const { data, error, reload } = useRequest("/cutting-plans");
  const { data: products } = useRequest("/products");
  const { data: molds } = useRequest("/molds");
  const [editing, setEditing] = useState(undefined);
  const [fabricRules, setFabricRules] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const loadRules = async (productId) => {
    if (!productId) {
      setFabricRules([]);
      return [];
    }
    const rules = (await api(`/products/${productId}/delivery-rules`)).filter(
      (rule) => rule.library_type === "布料库",
    );
    setFabricRules(rules);
    return rules;
  };
  useEffect(() => {
    if (editing?.product_id)
      loadRules(editing.product_id).catch((reason) =>
        setMessage(reason.message),
      );
    else setFabricRules([]);
  }, [editing?.product_id]);
  const chooseProduct = async (productId) => {
    setEditing((value) => ({
      ...value,
      product_id: productId,
      delivery_rule_id: "",
      mold_ids: [],
    }));
  };
  const matchingMoldIds = (rule) =>
    (molds || [])
      .filter(
        (item) =>
          Number(item.product_id) === Number(editing?.product_id) &&
          Number(item.cutting_part_material_id) === Number(rule?.material_id),
      )
      .map((item) => item.id);
  const chooseRule = (ruleId) => {
    const rule = fabricRules.find((item) => String(item.id) === String(ruleId));
    setEditing((value) => ({
      ...value,
      delivery_rule_id: ruleId,
      mold_ids: value.cutting_mode === "刀模裁剪" ? matchingMoldIds(rule) : [],
      name: value.name || `${rule?.material_name || ""} 下料参考`,
    }));
  };
  const changeCuttingMode = (cuttingMode) => {
    const rule = fabricRules.find(
      (item) => String(item.id) === String(editing.delivery_rule_id),
    );
    setEditing((value) => ({
      ...value,
      cutting_mode: cuttingMode,
      mold_ids: cuttingMode === "刀模裁剪" ? matchingMoldIds(rule) : [],
    }));
  };
  const toggleMold = (moldId) =>
    setEditing((value) => {
      const ids = value.mold_ids || [];
      return {
        ...value,
        mold_ids: ids.includes(moldId)
          ? ids.filter((id) => id !== moldId)
          : [...ids, moldId],
      };
    });
  const upload = (file) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setMessage("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      setMessage("下料参考图不能超过 30MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setUploading(true);
        setMessage("");
        const image = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        setEditing((value) => ({
          ...value,
          image_url: image.url,
          image_thumbnail_url: image.thumbnailUrl,
          image_mime_type: file.type,
          image_file_size: file.size,
        }));
      } catch (reason) {
        setMessage(reason.message);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const save = async (event) => {
    event.preventDefault();
    try {
      await api(
        editing.id ? `/cutting-plans/${editing.id}` : "/cutting-plans",
        { method: editing.id ? "PUT" : "POST", body: JSON.stringify(editing) },
      );
      setEditing(undefined);
      setMessage("");
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  const remove = async (item) => {
    if (!window.confirm(`确认删除下料方案「${item.name}」吗？`)) return;
    try {
      await api(`/cutting-plans/${item.id}`, { method: "DELETE" });
      reload();
    } catch (reason) {
      setMessage(reason.message);
    }
  };
  if (error) return <ErrorState error={error} retry={reload} />;
  if (!data || !products || !molds) return <LoadingState />;
  const selectedRule = fabricRules.find(
    (rule) => String(rule.id) === String(editing?.delivery_rule_id),
  );
  const productMolds = molds.filter(
    (item) => Number(item.product_id) === Number(editing?.product_id),
  );
  return (
    <>
      <Header
        title="下料库"
        subtitle="CUTTING REFERENCES / DELIVERY RULE & MOLD"
        action={
          <button
            className="primary"
            onClick={() => setEditing({ ...emptyCuttingPlan })}
          >
            + 新增下料参考
          </button>
        }
      />
      {message && <div className="error">{message}</div>}
      <section className="panel">
        <div className="toolbar">
          <span>
            每个下料参考绑定产品的一条布料配货规则；颜色由订单或里布规则决定，下料库不保存颜色。
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>参考图 / 名称</th>
              <th>产品</th>
              <th>关联布料规则</th>
              <th>单张包数</th>
              <th>拉布长度</th>
              <th>裁剪方式 / 刀模</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id}>
                <td>
                  <span className="material-with-image">
                    <ImageThumb
                      src={item.image_url}
                      alt={item.name}
                      fallback="料"
                    />
                    <span>
                      <b>{item.name}</b>
                      <small>{item.cutting_mode}</small>
                    </span>
                  </span>
                </td>
                <td>{item.product_sku}</td>
                <td>
                  <b>{item.material_name}</b>
                  <small>{item.material_specification || "无规格"}</small>
                </td>
                <td>{item.pieces_per_lay} 包</td>
                <td>{item.cutting_length_cm} cm</td>
                <td>
                  <b>{item.cutting_mode}</b>
                  <span className="mold-code-list">
                    {item.cutting_mode === "刀模裁剪"
                      ? item.molds?.length
                        ? item.molds.map((mold) => (
                            <small key={mold.id}>{mold.code}</small>
                          ))
                        : "未关联刀模"
                      : "无需关联刀模"}
                  </span>
                </td>
                <td className="actions">
                  <button
                    onClick={() =>
                      setEditing({ ...item, mold_ids: item.mold_ids || [] })
                    }
                  >
                    编辑
                  </button>
                  <button className="danger" onClick={() => remove(item)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {editing !== undefined && (
        <div className="modal-shade">
          <form className="modal cutting-plan-form" onSubmit={save}>
            <div className="modal-head">
              <div>
                <p>CUTTING REFERENCE</p>
                <h2>{editing.id ? "编辑下料参考" : "新增下料参考"}</h2>
              </div>
              <button type="button" onClick={() => setEditing(undefined)}>
                ×
              </button>
            </div>
            <div className="form-grid">
              <label>
                关联产品
                <select
                  value={editing.product_id || ""}
                  onChange={(event) => chooseProduct(event.target.value)}
                  required
                >
                  <option value="">请选择产品</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                关联布料配货规则
                <select
                  value={editing.delivery_rule_id || ""}
                  onChange={(event) => chooseRule(event.target.value)}
                  required
                  disabled={!editing.product_id}
                >
                  <option value="">请选择布料规则</option>
                  {fabricRules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.category === "里布" ? "里布" : "面布"} ·{" "}
                      {rule.material_name} · 单张{rule.quantity_per_product}包 ·{" "}
                      {rule.cutting_length_cm}cm
                    </option>
                  ))}
                </select>
              </label>
              <label>
                下料参考名称
                <input
                  value={editing.name || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                裁剪方式
                <select
                  value={editing.cutting_mode || "手工裁剪"}
                  onChange={(event) => changeCuttingMode(event.target.value)}
                >
                  {["手工裁剪", "刀模裁剪", "其他裁剪"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                规则参数
                <input
                  value={
                    selectedRule
                      ? `单张 ${selectedRule.quantity_per_product} 包 · 拉布 ${selectedRule.cutting_length_cm} cm`
                      : "选择规则后自动读取"
                  }
                  readOnly
                />
              </label>
              <label className="full">
                下料参考图
                <ImageUploadDropZone
                  src={editing.image_url}
                  alt="下料参考预览"
                  actionText="+ 上传图片（最大30MB）"
                  uploading={uploading}
                  onFile={upload}
                />
              </label>
              {editing.cutting_mode === "刀模裁剪" && (
                <fieldset className="full mold-selector">
                  <legend>关联刀模</legend>
                  <small>
                    选择刀模裁剪后自动勾选使用该布料的裁片刀模，可以手动增减。
                  </small>
                  <div>
                    {productMolds.map((mold) => (
                      <label key={mold.id}>
                        <input
                          type="checkbox"
                          checked={(editing.mold_ids || []).includes(mold.id)}
                          onChange={() => toggleMold(mold.id)}
                        />
                        <ImageThumb
                          src={mold.image_url}
                          alt={mold.code}
                          fallback="刀"
                        />
                        <span>
                          <b>{mold.code}</b>
                          <small>{mold.cutting_part_name || mold.name}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <label className="full">
                备注说明
                <textarea
                  value={editing.notes || ""}
                  onChange={(event) =>
                    setEditing((value) => ({
                      ...value,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                取消
              </button>
              <button className="primary" disabled={uploading}>
                保存下料参考
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function AccessoriesEditor({ value, onChange }) {
  const { data } = useRequest("/materials");
  const materials = data || [];
  const selectable = materials.filter(
    (item) => !fabricCategories.includes(item.category_name),
  );
  const update = (index, field, fieldValue) =>
    onChange(
      value.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: fieldValue } : item,
      ),
    );
  return (
    <section className="editor-block">
      <div className="block-title">
        <div>
          <b>配件资料</b>
          <small>配件主体从线材库或配件库调用，颜色单独选择。</small>
        </div>
        <button
          type="button"
          onClick={() => onChange([...value, emptyAccessory()])}
        >
          + 添加配件
        </button>
      </div>
      <div className="accessory-editor">
        <div className="accessory-head">
          <span>库内名称</span>
          <span>材质</span>
          <span>规格</span>
          <span>单独颜色</span>
          <span>数量</span>
          <span>备注说明</span>
          <span />
        </div>
        {value.map((item, index) => {
          const selected = materials.find(
            (material) => String(material.id) === String(item.material_id),
          );
          return (
            <div className="accessory-row" key={index}>
              <select
                value={item.material_id || ""}
                onChange={(event) =>
                  update(index, "material_id", event.target.value)
                }
              >
                <option value="">请选择库内配件</option>
                {selectable.map((material) => (
                  <option key={material.id} value={material.id}>
                    {material.name} · {material.specification || "无规格"}
                  </option>
                ))}
              </select>
              <span>{selected?.category_name || "—"}</span>
              <span>{selected?.specification || "—"}</span>
              <ColorField
                value={item.color}
                onChange={(color) => update(index, "color", color)}
                label=""
              />
              <input
                type="number"
                min="0"
                step="any"
                value={item.quantity || ""}
                onChange={(event) =>
                  update(index, "quantity", event.target.value)
                }
                placeholder="数量"
              />
              <input
                value={item.notes || ""}
                onChange={(event) => update(index, "notes", event.target.value)}
                placeholder="备注说明"
              />
              <button
                type="button"
                className="danger"
                onClick={() =>
                  onChange(value.filter((_, itemIndex) => itemIndex !== index))
                }
              >
                移除
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
