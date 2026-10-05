import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "./api-client.js";

const words = {
  zh: {
    title: "报价单",
    customer: "客户",
    date: "报价日期",
    valid: "有效期",
    product: "产品",
    qty: "数量",
    price: "单价",
    discount: "折扣",
    amount: "金额",
    terms: "报价条款",
    total: "报价总额",
    note: "备注",
  },
  en: {
    title: "QUOTATION",
    customer: "Customer",
    date: "Date",
    valid: "Valid Until",
    product: "Product",
    qty: "Quantity",
    price: "Unit Price",
    discount: "Discount",
    amount: "Amount",
    terms: "Terms & Conditions",
    total: "Grand Total",
    note: "Notes",
  },
  ja: {
    title: "見積書",
    customer: "顧客",
    date: "見積日",
    valid: "有効期限",
    product: "製品",
    qty: "数量",
    price: "単価",
    discount: "割引",
    amount: "金額",
    terms: "取引条件",
    total: "合計金額",
    note: "備考",
  },
  ko: {
    title: "견적서",
    customer: "고객",
    date: "견적일",
    valid: "유효기간",
    product: "제품",
    qty: "수량",
    price: "단가",
    discount: "할인",
    amount: "금액",
    terms: "거래 조건",
    total: "총 견적금액",
    note: "비고",
  },
  es: {
    title: "COTIZACIÓN",
    customer: "Cliente",
    date: "Fecha",
    valid: "Válido hasta",
    product: "Producto",
    qty: "Cantidad",
    price: "Precio unitario",
    discount: "Descuento",
    amount: "Importe",
    terms: "Términos y condiciones",
    total: "Total",
    note: "Notas",
  },
};
const languageName = {
  zh: "中文",
  en: "中文 + English",
  ja: "中文 + 日本語",
  ko: "中文 + 한국어",
  es: "中文 + Español",
};
const documentLocales = {
  zh: { from: "报价方", to: "客户", merchandiser: "跟单员", phone: "公司电话", address: "公司地址", origin: "发货地", number: "编号", size: "尺寸", color: "颜色", process: "工艺", packaging: "包装", leadTime: "工期", subtotal: "小计", days: "天", unit: "个", pending: "待确认", terms: "商务条款", afterSales: "售后", project: "项目", contact: "联系人", productPlan: "款产品报价方案" },
  en: { from: "From", to: "Customer", merchandiser: "Merchandiser", phone: "Company phone", address: "Company address", origin: "Shipping origin", number: "No.", size: "Size", color: "Color", process: "Process", packaging: "Packaging", leadTime: "Lead time", subtotal: "Subtotal", days: "days", unit: "pcs", pending: "To confirm", terms: "Terms & Conditions", afterSales: "After-sales", project: "Project", contact: "Contact", productPlan: "product quotation plan(s)" },
  ja: { from: "見積元", to: "お客様", merchandiser: "担当者", phone: "会社電話", address: "会社住所", origin: "出荷地", number: "番号", size: "サイズ", color: "カラー", process: "加工", packaging: "包装", leadTime: "納期", subtotal: "小計", days: "日", unit: "個", pending: "要確認", terms: "取引条件", afterSales: "アフターサービス", project: "案件", contact: "ご担当者", productPlan: "製品見積案" },
  ko: { from: "견적처", to: "고객", merchandiser: "담당자", phone: "회사 전화", address: "회사 주소", origin: "출고지", number: "번호", size: "사이즈", color: "색상", process: "공정", packaging: "포장", leadTime: "납기", subtotal: "소계", days: "일", unit: "개", pending: "확인 필요", terms: "거래 조건", afterSales: "A/S", project: "프로젝트", contact: "담당자", productPlan: "개 제품 견적안" },
  es: { from: "Proveedor", to: "Cliente", merchandiser: "Gestor", phone: "Teléfono", address: "Dirección", origin: "Origen del envío", number: "N.º", size: "Tamaño", color: "Color", process: "Proceso", packaging: "Embalaje", leadTime: "Plazo", subtotal: "Subtotal", days: "días", unit: "uds.", pending: "Por confirmar", terms: "Términos y condiciones", afterSales: "Posventa", project: "Proyecto", contact: "Contacto", productPlan: "propuesta(s) de cotización" },
};
const bilingualDocumentLabel = (language, chinese, translated) => language === "zh" || !translated ? chinese : `${chinese} / ${translated}`;
const translatedTermContent = (term, language) => {
  if (language === "zh") return "";
  const standard = fixedTerms.find((item) => item.label === term.label);
  return standard?.foreign?.[language] || term.contentForeign || "";
};
const templateName = {
  classic: "默认经典风格",
  catalog: "极简杂志版",
  compare: "优雅蓝金风格",
  confirm: "手绘可爱风格",
};
const templateHelp = {
  classic: "默认正式报价样式，适合采购、大客户和多数量档位",
  catalog: "衬线标题、暖白留白与编辑式报价结构，适合品牌客户",
  compare: "海军蓝与金色点缀的多款报价版式，适合展示阶梯价格与商务条款",
  confirm: "手账纸张、手绘描边与彩色贴纸式报价，适合轻松亲切的品牌客户",
};
const legacyTemplate = { business: "classic", brand: "catalog", trade: "compare" };
const fixedTerms = [
  { label: "付款方式 / Payment", content: "如有尾款未付清，发货前需付清尾款后才能发货。", foreign: { en: "Any outstanding balance must be paid in full before shipment.", ja: "未払い残金がある場合、出荷前に全額お支払いいただいた後に発送します。", ko: "미지급 잔금이 있는 경우 출고 전에 전액 결제해야 배송할 수 있습니다.", es: "Cualquier saldo pendiente deberá pagarse íntegramente antes del envío." } },
  { label: "生产 Production", content: "生产以最终确认的样品为准；工期从资料和定金确认后计算。", foreign: { en: "Production is based on the final approved sample. Lead time starts after all required information and the deposit are confirmed.", ja: "生産は最終承認済みサンプルを基準とし、必要資料と前金の確認後から納期を計算します。", ko: "생산은 최종 승인된 샘플을 기준으로 하며, 자료와 계약금 확인 후 납기를 계산합니다.", es: "La producción se basa en la muestra final aprobada. El plazo comienza tras confirmar la información y el anticipo." } },
  { label: "样品费 Sample", content: "¥200/每款，下大货订单后可退样品费。", foreign: { en: "¥200 per style. The sample fee is refundable after placing a bulk order.", ja: "1型につき¥200。量産注文後にサンプル代を返金できます。", ko: "스타일당 ¥200이며, 대량 주문 후 샘플 비용을 환불받을 수 있습니다.", es: "¥200 por modelo. El coste de la muestra es reembolsable tras realizar un pedido al por mayor." } },
  { label: "物流与交付 / Shipping & Delivery", content: "生产工期不含运输与清关时间；发货前确认数量、包装、运输方式及收货信息。", foreign: { en: "Production lead time excludes transport and customs clearance. Quantity, packaging, shipping method and consignee details will be confirmed before dispatch.", ja: "生産納期に輸送・通関時間は含みません。出荷前に数量、包装、輸送方法、納品先を確認します。", ko: "생산 납기에는 운송 및 통관 시간이 포함되지 않습니다. 출고 전 수량, 포장, 운송 방식 및 수령 정보를 확인합니다.", es: "El plazo de producción no incluye transporte ni aduanas. Antes del envío se confirmarán la cantidad, el embalaje, el transporte y el destinatario." } },
];
const makeFixedTerms = (language = "zh") => fixedTerms.map((term) => ({
  label: term.label,
  content: term.content,
  contentForeign: language === "zh" ? "" : term.foreign[language] || "",
  enabled: true,
}));
const today = () => new Date().toISOString().slice(0, 10);
const emptyItem = () => ({
  id: `new-${Date.now()}`,
  productName: "新产品",
  productNameForeign: "",
  sampleNo: "",
  customerSku: "",
  imageUrl: "",
  showImage: true,
  color: "",
  dimensions: "",
  specialProcess: "",
  quantity: 1,
  unit: "个",
  unitPrice: 0,
  discountRate: 0,
  deliveryDays: "",
  packaging: "",
  notes: "",
  notesForeign: "",
  costSnapshot: {},
  priceTiers: [],
});
const mapQuote = (q) => ({
  ...q,
  customerName: q.customer_name || "",
  quoteDate: q.quote_date || today(),
  validUntil: q.valid_until || "",
  contactName: q.contact_name || "",
  exchangeRate: q.exchange_rate || 1,
  templateKey: legacyTemplate[q.template_key] || q.template_key || "classic",
  languageKey: q.language_key || "zh",
  orderDiscount: q.order_discount || 0,
  shippingFee: q.shipping_fee || 0,
  taxRate: q.tax_rate || 0,
  depositRate: q.deposit_rate ?? 100,
  paymentTerms: q.payment_terms || "",
  tradeTerm: q.trade_term || "",
  deliveryTerm: q.delivery_term || "",
  packagingTerm: q.packaging_term || "",
  shippingTerm: q.shipping_term || "",
  qualityTerm: q.quality_term || "",
  customerNotes: q.customer_notes || "",
  internalNotes: q.internal_notes || "",
  shippingOrigin: q.shipping_origin || "",
  complaintContact: q.complaint_contact || "",
  complaintPhone: q.complaint_phone || "",
  complaintEmail: q.complaint_email || "",
  complaintWechat: q.complaint_wechat || "",
  items: (q.items || []).map((i) => ({
    ...i,
    sampleQuoteId: i.sample_quote_id,
    sampleNo: i.sample_no || "",
    customerSku: i.customer_sku || "",
    productName: i.product_name || "",
    productNameForeign: i.product_name_foreign || "",
    imageUrl: i.image_url || "",
    showImage: Boolean(i.show_image),
    specialProcess: i.special_process || "",
    unitPrice: i.unit_price || 0,
    discountRate: i.discount_rate || 0,
    deliveryDays: i.delivery_days || "",
    packaging: i.packaging || "",
    notesForeign: i.notes_foreign || "",
    costSnapshot: i.costSnapshot || {},
    priceTiers: Array.isArray(i.priceTiers) ? i.priceTiers : [],
  })),
  fees: (q.fees || []).map((f) => ({ ...f, enabled: Boolean(f.enabled) })),
  terms: ((q.terms?.length && q.terms.length !== 8) ? q.terms : makeFixedTerms(q.language_key || "zh"))
    .filter((t) => !/报价有效期|Quotation Validity/i.test(String(t.label || "")))
    .map((t) => ({
    ...t,
    contentForeign: t.content_foreign || "",
    enabled: Boolean(t.enabled),
    })),
});
const money = (value, currency = "CNY", language = "zh") =>
  new Intl.NumberFormat(language === "zh" ? "zh-CN" : language, {
    style: "currency",
    currency: currency || "CNY",
  }).format(Number(value) || 0);

const itemPrices = (item) => [
  { quantity: item.quantity, unitPrice: item.unitPrice, deliveryDays: item.deliveryDays, primary: true },
  ...(item.priceTiers || []),
].filter((row) => Number(row.quantity) > 0 || Number(row.unitPrice) > 0 || row.deliveryDays);

function ProposalHeader({ quote, title = "QUOTATION" }) {
  return <header className="proposal-header"><div><small>ZHIYUAN · BAG PRODUCT SOLUTIONS</small><h1>{title}</h1><b>{quote.quote_no}</b></div><div><strong>知源箱包</strong><span>{quote.contactName || quote.customerName || "—"}</span><small>{quote.customerName || ""}</small></div></header>;
}

function CatalogPreview({ quote, systemSettings = {} }) {
  const items = quote.items.filter((item) => [item.productName,item.imageUrl,item.dimensions,item.color,item.specialProcess,item.packaging,item.notes].some((value)=>String(value||"").trim()));
  const terms = quote.terms.filter((term)=>term.enabled && String(term.content||"").trim());
  const company = systemSettings.companyName || systemSettings.companyShortName || "";
  const contacts = [
    `订单跟单员：${quote.salesperson || "—"}`,
    `公司电话：${systemSettings.phone || systemSettings.afterSalesPhone || "—"}`,
    `公司地址：${systemSettings.address || "—"}`,
  ];
  const afterSales = systemSettings.showAfterSalesInDocuments === false ? [] : [systemSettings.afterSalesName,systemSettings.afterSalesPhone,systemSettings.afterSalesEmail,systemSettings.afterSalesWechat].filter(Boolean);
  const language = quote.languageKey || "zh";
  const locale = documentLocales[language] || documentLocales.zh;
  const label = (zh, translated) => bilingualDocumentLabel(language, zh, translated);
  const groups = items.length
    ? items.length <= 2
      ? [items]
      : [items.slice(0,2), ...Array.from({length:Math.ceil(Math.max(0,items.length-2)/2)},(_,index)=>items.slice(2+index*2,2+index*2+2))]
    : [[]];
  const firstTermLimit = items.length <= 1 ? 4 : items.length === 2 ? 2 : 0;
  const firstTerms = terms.slice(0,firstTermLimit);
  const remaining = terms.slice(firstTermLimit);
  const termGroups = Array.from({length:Math.ceil(remaining.length/4)},(_,index)=>remaining.slice(index*4,index*4+4));
  const pageCount = Math.max(1,groups.length)+termGroups.length;
  const header = (continued=false)=>continued ? <div className="mag-continuation"><span>{quote.quote_no}</span><b>{label("续页", language === "en" ? "CONTINUED" : language === "ja" ? "続き" : language === "ko" ? "계속" : language === "es" ? "CONTINUACIÓN" : "")}</b></div> : <><header className="mag-hero"><small>QUOTATION</small><h1>{label("报价单", words[language]?.title)}</h1><span>{quote.quote_no}{quote.quoteDate&&` · ${quote.quoteDate}`}</span></header><section className="mag-parties"><div><small>{label("报价方", locale.from)}</small>{company&&<b>{company}</b>}<span>{label("跟单员",locale.merchandiser)}：{quote.salesperson||"—"}</span><span>{label("公司电话",locale.phone)}：{systemSettings.phone||systemSettings.afterSalesPhone||"—"}</span><span>{label("公司地址",locale.address)}：{systemSettings.address||"—"}</span>{quote.shippingOrigin&&<span>{label("发货地",locale.origin)}：{quote.shippingOrigin}</span>}</div><i/><div><small>{label("客户", locale.to)}</small>{quote.contactName&&<b>{quote.contactName}</b>}{quote.customerName&&<strong>{quote.customerName}</strong>}{quote.phone&&<span>{quote.phone}</span>}{quote.email&&<span>{quote.email}</span>}<span>{[quote.currency,quote.validUntil&&`${label("有效期",words[language]?.valid)} ${quote.validUntil}`,Number(quote.shippingFee)>0&&`运费 ${money(quote.shippingFee,quote.currency,quote.languageKey)}`].filter(Boolean).join(" · ")}</span></div></section></>;
  const product=(item,index)=><section className="mag-product" key={item.id||index}><header><b>{String(index+1).padStart(2,"0")}</b>{item.imageUrl&&item.showImage&&<img src={item.imageUrl} alt=""/>}<span><h3>{item.productName}{language!=="zh"&&item.productNameForeign&&<em>{item.productNameForeign}</em>}</h3>{item.sampleNo&&item.sampleNo.trim()!==item.productName.trim()&&<small>{label("编号",locale.number)} {item.sampleNo}</small>}<small>{[[label("尺寸",locale.size),item.dimensions],[label("颜色",locale.color),item.color],[label("工艺",locale.process),item.specialProcess],[label("包装",locale.packaging),item.packaging]].filter(([,v])=>v).map(([k,v])=>`${k} ${v}`).join(" · ")}</small></span></header><div className="mag-price"><div className="head"><b>{label("数量",words[language]?.qty)}</b><b>{label("单价",words[language]?.price)}</b><b>{label("工期",locale.leadTime)}</b><b>{label("小计",locale.subtotal)}</b></div>{itemPrices(item).map((row,i)=><div key={i}><span>{Number(row.quantity).toLocaleString()} {locale.unit}</span><strong className={i===itemPrices(item).length-1?"best":""}>{money(row.unitPrice,quote.currency,quote.languageKey)}</strong><span>{row.deliveryDays?`${row.deliveryDays} ${locale.days}`:locale.pending}</span><b>{money(Number(row.quantity)*Number(row.unitPrice),quote.currency,quote.languageKey)}</b></div>)}</div>{item.notes&&<p>{item.notes}</p>}</section>;
  const termSection=(rows)=><section className="mag-terms"><h2>{label("商务条款",locale.terms)}</h2><div>{rows.map((term,index)=>{const translated=translatedTermContent(term,language);return <article key={term.id||index}><b>{term.label}</b><p>{term.content}</p>{translated&&<em>{translated}</em>}</article>})}</div></section>;
  const footer=()=>afterSales.length>0&&<section className="mag-contact"><span>{label("售后",locale.afterSales)}</span><b>{systemSettings.afterSalesName||"售后服务"}</b>{afterSales.slice(1).length>0&&<p>{afterSales.slice(1).join(" · ")}</p>}{company&&<small>{company}</small>}</section>;
  let productOffset = 0;
  return <div className={`quotation-document template-catalog language-${quote.languageKey}`}>{groups.map((rows,page)=>{const start=productOffset;productOffset+=rows.length;return <article className="quotation-paper mag-paper" key={page}>{header(page>0)}{rows.map((item,offset)=>product(item,start+offset))}{page===groups.length-1&&<div className="mag-closing">{firstTerms.length>0&&termSection(firstTerms)}{termGroups.length===0&&quote.customerNotes&&<div className="mag-note">{quote.customerNotes}</div>}{termGroups.length===0&&footer()}</div>}<footer><span>{quote.quote_no}</span><span>{page+1} / {pageCount}</span></footer></article>})}{termGroups.map((rows,index)=><article className="quotation-paper mag-paper" key={`t${index}`}>{header(true)}<div className="mag-closing">{termSection(rows)}{index===termGroups.length-1&&quote.customerNotes&&<div className="mag-note">{quote.customerNotes}</div>}{index===termGroups.length-1&&footer()}</div><footer><span>{quote.quote_no}</span><span>{Math.max(1,groups.length)+index+1} / {pageCount}</span></footer></article>)}</div>;
}

function LegacyComparePreview({ quote }) {
  const groups = Array.from({length:Math.ceil(quote.items.length/3)},(_,i)=>quote.items.slice(i*3,i*3+3));
  return <div className={`quotation-document template-compare language-${quote.languageKey}`}>{groups.map((items,page)=><article className="quotation-paper compare-page" key={page}>
    <ProposalHeader quote={quote} title="PRODUCT COMPARISON" />
    <section className="compare-grid" style={{"--compare-count":items.length}}>
      <div className="compare-label">款式</div>{items.map((item,i)=><div className="compare-product-head" key={i}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:<span>产品图</span>}<b>{item.productName}</b></div>)}
      {[['尺寸','dimensions'],['颜色','color'],['工艺','specialProcess'],['包装','packaging'],['备注','notes']].map(([label,key])=><Fragment key={key}><div className="compare-label">{label}</div>{items.map((item,i)=><div key={i}>{item[key]||'—'}</div>)}</Fragment>)}
      {Array.from(new Set(items.flatMap(item=>itemPrices(item).map(x=>String(x.quantity))))).map(qty=><Fragment key={qty}><div className="compare-label price">{qty}个</div>{items.map((item,i)=>{const row=itemPrices(item).find(x=>String(x.quantity)===qty);return <div className="compare-price" key={i}>{row?<><strong>{money(row.unitPrice,quote.currency,quote.languageKey)}</strong><small>{row.deliveryDays?`${row.deliveryDays}天`:'待确认'}</small></>:<span>未报价</span>}</div>})}</Fragment>)}
    </section><footer><span>{quote.quote_no}</span><span>{page+1} / {groups.length}</span></footer>
  </article>)}</div>;
}

function ComparePreview({ quote, systemSettings = {} }) {
  const items = quote.items.filter((item) => [item.productName, item.imageUrl, item.dimensions, item.color, item.specialProcess, item.packaging, item.notes].some((value) => String(value || "").trim()));
  const terms = quote.terms.filter((term) => term.enabled && String(term.content || "").trim());
  const company = systemSettings.companyName || systemSettings.companyShortName || "";
  const companyTitle = company || quote.salesperson || "";
  const companyContacts = [systemSettings.phone, systemSettings.email, systemSettings.address].filter(Boolean);
  const afterSales = systemSettings.showAfterSalesInDocuments === false ? [] : [systemSettings.afterSalesName, systemSettings.afterSalesPhone, systemSettings.afterSalesEmail, systemSettings.afterSalesWechat].filter(Boolean);
  const language = quote.languageKey || "zh";
  const locale = documentLocales[language] || documentLocales.zh;
  const label = (zh, translated) => bilingualDocumentLabel(language, zh, translated);
  const metaCards = [
    [label("报价方", locale.from), "宿州青鹿箱包有限公司"],
    [label("发货地", locale.origin), quote.shippingOrigin || "安徽宿州"],
    [label("跟单员", locale.merchandiser), quote.salesperson || locale.pending],
    [label("币种", language === "zh" ? "" : language === "en" ? "Currency" : language === "ja" ? "通貨" : language === "ko" ? "통화" : "Moneda"), quote.currency || "CNY"],
  ];
  return <div className={`quotation-document template-compare language-${quote.languageKey}`}><article className="quotation-paper compare-page elegant-compare-page">
    <header className="elegant-compare-hero">
      <div><small>QUOTATION DOCUMENT</small><h1>{label("报价单",words[language]?.title)}</h1><p>{label("编号",locale.number)} {quote.quote_no}{quote.quoteDate && <>　·　{label("日期",words[language]?.date)} {quote.quoteDate}</>}{quote.validUntil && <>　·　{label("有效期",words[language]?.valid)} {quote.validUntil}</>}</p></div>
      <div className="elegant-compare-company">{companyTitle && <b>{companyTitle}</b>}{systemSettings.description && <span>{systemSettings.description}</span>}{companyContacts.map((line) => <small key={line}>{line}</small>)}</div>
    </header>
    <section className="elegant-compare-meta">{metaCards.map(([name, value]) => <div key={name}><small>{name}</small><b>{value}</b></div>)}</section>
    <section className="elegant-compare-parties">
      <div><small>{label("客户",locale.to)}</small><b>{quote.customerName || quote.contactName || locale.pending}</b>{quote.contactName && quote.customerName && <span>{label("联系人",locale.contact)}：{quote.contactName}</span>}{quote.phone && <span>{quote.phone}</span>}{quote.email && <span>{quote.email}</span>}</div>
      <div><small>{label("项目",locale.project)}</small><b>{items.length > 0 ? `${items.length} ${label("款产品报价方案",locale.productPlan)}` : label("产品报价方案",locale.productPlan)}</b><span>{items.map((item) => item.productName).filter(Boolean).join(" · ") || locale.pending}</span>{quote.shippingOrigin && <span>{label("交货安排",locale.origin)}：{quote.shippingOrigin}</span>}</div>
    </section>
    <section className="elegant-compare-products">{items.map((item, index) => {
      const prices = itemPrices(item);
      const specs = [[label("款号",locale.number), item.sampleNo], [label("尺寸",locale.size), item.dimensions], [label("颜色",locale.color), item.color], [label("工艺",locale.process), item.specialProcess], [label("包装",locale.packaging), item.packaging]].filter(([, value]) => String(value || "").trim());
      return <article className="elegant-compare-product" key={item.id || index}>
        <header><strong>{String.fromCharCode(65 + (index % 26))}</strong><div><h2>{item.productName}{item.productNameForeign && <em>{item.productNameForeign}</em>}</h2>{specs.length > 0 && <p>{specs.map(([name, value]) => `${name} ${value}`).join("　")}</p>}</div></header>
        <div className="elegant-price-table"><div className="head"><b>{label("数量",words[language]?.qty)}</b><b>{label("单价",words[language]?.price)}</b><b>{label("工期",locale.leadTime)}</b><b>{label("小计",locale.subtotal)}</b></div>{prices.map((row, rowIndex) => <div key={rowIndex}><b>{Number(row.quantity).toLocaleString()} {locale.unit}</b><strong className={rowIndex === prices.length - 1 ? "best" : ""}>{money(row.unitPrice, quote.currency, quote.languageKey)}</strong><span>{row.deliveryDays ? `${row.deliveryDays} ${locale.days}` : locale.pending}</span><b>{money(Number(row.quantity) * Number(row.unitPrice), quote.currency, quote.languageKey)}</b></div>)}</div>
        {item.notes && <p className="elegant-product-note">{item.notes}</p>}
      </article>;
    })}</section>
    {terms.length > 0 && <section className="elegant-compare-terms"><header><h2>{label("商务条款",locale.terms)}</h2></header><div>{terms.map((term, index) => {const translated=translatedTermContent(term,language);return <article key={term.id || index}><b>{term.label}</b><p>{term.content}</p>{translated&&<em>{translated}</em>}</article>})}</div>{quote.customerNotes && <p className="elegant-terms-note">{quote.customerNotes}</p>}</section>}
    <section className="elegant-compare-contact"><div><b>{afterSales[0] || "售后服务"}</b><span>{label("售后人员",locale.afterSales)}</span></div><p>{afterSales.slice(1).map((value) => <span key={value}>{value}</span>)}</p></section>
    {company && <div className="elegant-compare-brand">{company}</div>}
    <footer><span>{quote.quote_no}</span><span>01 / 01</span></footer>
  </article></div>;
}

function LegacyConfirmPreview({ quote, totals }) {
  return <div className={`quotation-document template-confirm language-${quote.languageKey}`}><article className="quotation-paper confirm-page">
    <ProposalHeader quote={quote} title={`QUOTATION · ${quote.quote_no}`} />
    <section className="confirm-customer"><b>{quote.contactName || quote.customerName || "—"}</b><span>{quote.customerName}</span><small>{quote.quoteDate} · {quote.currency}</small></section>
    <div className="confirm-items">{quote.items.map((item,index)=><section key={item.id||index}>{item.imageUrl?<img src={item.imageUrl} alt=""/>:<span className="confirm-image">产品图</span>}<div><small>STYLE {index+1}</small><h2>{item.productName}</h2><p>{[item.dimensions,item.color,item.specialProcess,item.packaging].filter(Boolean).join(' · ')||'规格待确认'}</p></div><strong>{item.quantity}个</strong><strong>{money(item.unitPrice,quote.currency,quote.languageKey)}</strong><b>{money(Number(item.quantity)*Number(item.unitPrice),quote.currency,quote.languageKey)}</b></section>)}</div>
    <section className="confirm-total"><span>商品金额<b>{money(totals.merchandise,quote.currency)}</b></span><strong>报价总额<b>{quote.currency} {money(totals.total,quote.currency)}</b></strong><small>订金 {money(totals.deposit,quote.currency)} · 尾款 {money(totals.balance,quote.currency)}</small></section>
    <section className="confirm-terms">{quote.terms.filter(x=>x.enabled).slice(0,3).map((x,i)=><p key={i}><b>{x.label}</b>{x.content}</p>)}</section><footer><span>{quote.quote_no}</span><span>01 / 01</span></footer>
  </article></div>;
}

function CuteHanddrawnPreview({ quote, systemSettings = {} }) {
  const items = quote.items.filter((item) => [item.productName, item.imageUrl, item.dimensions, item.color, item.specialProcess, item.packaging, item.notes].some((value) => String(value || "").trim()));
  const terms = quote.terms.filter((term) => term.enabled && String(term.content || "").trim());
  const company = systemSettings.companyName || systemSettings.companyShortName || "宿州青鹿箱包有限公司";
  const companyLines = [systemSettings.address, systemSettings.phone, systemSettings.email].filter(Boolean);
  const afterSales = systemSettings.showAfterSalesInDocuments === false ? [] : [systemSettings.afterSalesName, systemSettings.afterSalesPhone, systemSettings.afterSalesEmail, systemSettings.afterSalesWechat, systemSettings.serviceHours].filter(Boolean);
  const language = quote.languageKey || "zh";
  const foreign = language !== "zh" ? words[language] : null;
  const dual = (zh, translated) => foreign && translated ? `${zh} / ${translated}` : zh;
  const cuteLanguage = {
    zh: { from: "报价方", to: "致客户", contact: "联系人", project: "项目", productQuote: "款产品报价", currency: "币种", origin: "发货地", style: "款号", size: "尺寸", color: "颜色", process: "工艺", packaging: "包装", leadTime: "工期", subtotal: "小计", unit: "个", days: "天", pending: "待确认", terms: "商务条款", contactUs: "联系我们", afterSales: "售后人员", recommended: "推荐", termNames: ["付款方式", "生产", "样品费", "物流与交付"] },
    en: { from: "From", to: "Customer", contact: "Contact", project: "Project", productQuote: "product quotation(s)", currency: "Currency", origin: "Shipping origin", style: "Style No.", size: "Size", color: "Color", process: "Process", packaging: "Packaging", leadTime: "Lead time", subtotal: "Subtotal", unit: "pcs", days: "days", pending: "To confirm", terms: "Terms & Conditions", contactUs: "Contact Us", afterSales: "After-sales Contact", recommended: "Best", termNames: ["Payment", "Production", "Sample", "Shipping & Delivery"] },
    ja: { from: "見積元", to: "お客様", contact: "ご担当者", project: "案件", productQuote: "製品の見積", currency: "通貨", origin: "出荷地", style: "品番", size: "サイズ", color: "カラー", process: "加工", packaging: "包装", leadTime: "納期", subtotal: "小計", unit: "個", days: "日", pending: "要確認", terms: "取引条件", contactUs: "お問い合わせ", afterSales: "アフターサービス", recommended: "推奨", termNames: ["支払条件", "生産", "サンプル費", "物流・納品"] },
    ko: { from: "견적처", to: "고객", contact: "담당자", project: "프로젝트", productQuote: "개 제품 견적", currency: "통화", origin: "출고지", style: "품번", size: "사이즈", color: "색상", process: "공정", packaging: "포장", leadTime: "납기", subtotal: "소계", unit: "개", days: "일", pending: "확인 필요", terms: "거래 조건", contactUs: "문의하기", afterSales: "A/S 담당자", recommended: "추천", termNames: ["결제 방식", "생산", "샘플 비용", "물류 및 배송"] },
    es: { from: "Proveedor", to: "Cliente", contact: "Contacto", project: "Proyecto", productQuote: "producto(s) cotizado(s)", currency: "Moneda", origin: "Origen del envío", style: "N.º de modelo", size: "Tamaño", color: "Color", process: "Proceso", packaging: "Embalaje", leadTime: "Plazo", subtotal: "Subtotal", unit: "uds.", days: "días", pending: "Por confirmar", terms: "Términos y condiciones", contactUs: "Contacto", afterSales: "Posventa", recommended: "Mejor", termNames: ["Pago", "Producción", "Muestra", "Envío y entrega"] },
  }[language] || {};
  const termTranslation = (term) => {
    if (!foreign) return "";
    const standardIndex = fixedTerms.findIndex((item) => item.label === term.label);
    return standardIndex >= 0
      ? fixedTerms[standardIndex]?.foreign?.[language] || ""
      : term.contentForeign || "";
  };
  return <div className={`quotation-document template-confirm template-cute language-${quote.languageKey}`}><article className="quotation-paper cute-paper">
    <header className="cute-header-card"><div><small>{dual("报价方", cuteLanguage.from)}</small><b>{company}</b>{companyLines.map((line) => <span key={line}>{line}</span>)}</div><div><h1>{dual("报价单", foreign?.title)}</h1><p><span>{quote.quote_no}</span>{quote.quoteDate && <span>{quote.quoteDate}</span>}{quote.validUntil && <span>{dual("有效期", foreign?.valid)} {quote.validUntil}</span>}</p></div></header>
    <section className="cute-customer-note"><small>{dual("致客户", cuteLanguage.to)}</small><b>{quote.customerName || quote.contactName || dual("待确认客户", cuteLanguage.pending)}</b><p>{quote.contactName && `${dual("联系人", cuteLanguage.contact)}：${quote.contactName}　`}{quote.phone || ""}</p><p>{dual("项目", cuteLanguage.project)}：<strong>{items.length ? `${items.length} ${dual("款产品报价", cuteLanguage.productQuote)}` : dual("产品报价", foreign?.title)}</strong>　{dual("币种", cuteLanguage.currency)}：{quote.currency || "CNY"}</p>{quote.shippingOrigin && <p>{dual("发货地", cuteLanguage.origin)}：{quote.shippingOrigin}</p>}</section>
    <div className="cute-divider"><i/><i/><i/></div>
    <section className="cute-products">{items.map((item, index) => {
      const prices = itemPrices(item);
      const specs = [[dual("款号", cuteLanguage.style), item.sampleNo], [dual("尺寸", cuteLanguage.size), item.dimensions], [dual("颜色", cuteLanguage.color), item.color], [dual("工艺", cuteLanguage.process), item.specialProcess], [dual("包装", cuteLanguage.packaging), item.packaging]].filter(([, value]) => String(value || "").trim());
      return <article className={`cute-product cute-color-${index % 4}`} key={item.id || index}>
        <header><div className="cute-product-mark">{item.showImage && item.imageUrl ? <img src={item.imageUrl} alt="" /> : String.fromCharCode(65 + (index % 26))}</div><div><h2>{item.productName}{foreign && item.productNameForeign && <small>{item.productNameForeign}</small>}</h2>{specs.length > 0 && <p>{specs.map(([name, value]) => `${name} ${value}`).join("　·　")}</p>}</div></header>
        {item.notes && <p className="cute-product-copy">{item.notes}</p>}
        <div className="cute-price-table"><div className="head"><b><span>数量</span>{foreign && <small>{foreign.qty}</small>}</b><b><span>单价</span>{foreign && <small>{foreign.price}</small>}</b><b><span>工期</span>{foreign && <small>{cuteLanguage.leadTime}</small>}</b><b><span>小计</span>{foreign && <small>{cuteLanguage.subtotal}</small>}</b></div>{prices.map((row, rowIndex) => <div key={rowIndex}><b>{Number(row.quantity).toLocaleString()} {cuteLanguage.unit}</b><strong data-best={cuteLanguage.recommended} className={rowIndex === prices.length - 1 ? "best" : ""}>{money(row.unitPrice, quote.currency, quote.languageKey)}</strong><span>{row.deliveryDays ? `${row.deliveryDays} ${cuteLanguage.days}` : cuteLanguage.pending}</span><b>{money(Number(row.quantity) * Number(row.unitPrice), quote.currency, quote.languageKey)}</b></div>)}</div>
      </article>;
    })}</section>
    {terms.length > 0 && <><div className="cute-section-title"><b>{dual("商务条款", cuteLanguage.terms)}</b><span/></div><section className="cute-terms-card"><div>{terms.map((term, index) => { const translated = termTranslation(term); const standardIndex = fixedTerms.findIndex((item) => item.label === term.label); return <article key={term.id || index}><b>{term.label}{foreign && standardIndex >= 0 && <small>{cuteLanguage.termNames[standardIndex]}</small>}</b><p>{term.content}</p>{foreign && translated && <em>{translated}</em>}</article>; })}</div>{quote.customerNotes && <p className="cute-terms-note">{quote.customerNotes}</p>}</section></>}
    <div className="cute-section-title"><b>{dual("联系我们", cuteLanguage.contactUs)}</b><span/></div><section className="cute-contact-card"><div><b>{afterSales[0] || quote.salesperson || "售后服务"}</b><span>{dual("售后人员", cuteLanguage.afterSales)}</span></div><p>{afterSales.slice(1).map((value) => <span key={value}>{value}</span>)}</p></section>
    <div className="cute-brand">{company}</div><footer><span>{quote.quote_no}</span><span>01 / 01</span></footer>
  </article></div>;
}

function ClassicPreview({ quote, totals, systemSettings = {} }) {
  const foreign = quote.languageKey !== "zh" ? words[quote.languageKey] : null;
  const label = (key) => foreign ? `${words.zh[key]} / ${foreign[key]}` : words.zh[key];
  const visibleItems = quote.items.filter((item) =>
    [item.productName, item.imageUrl, item.dimensions, item.color, item.specialProcess, item.packaging, item.notes]
      .some((value) => String(value || "").trim()),
  );
  const enabledTerms = quote.terms.filter((term) => term.enabled && String(term.content || "").trim());
  const companyName = systemSettings.companyName || systemSettings.companyShortName || "";
  const companyContacts = [systemSettings.phone, systemSettings.email].filter(Boolean);
  const showAfterSales = systemSettings.showAfterSalesInDocuments !== false;
  const afterSales = showAfterSales ? [
    systemSettings.afterSalesName,
    systemSettings.afterSalesPhone,
    systemSettings.afterSalesEmail,
    systemSettings.afterSalesWechat,
  ].filter(Boolean) : [];
  const quoteFacts = [
    (quote.quoteDate || quote.validUntil) && ["报价日期 · 有效期 / Date · Validity", [quote.quoteDate, quote.validUntil].filter(Boolean).join(" — ")],
    quote.currency && ["币种 / Currency", quote.currency],
    Number(quote.shippingFee) > 0 && ["运费 / Shipping", money(quote.shippingFee, quote.currency, quote.languageKey)],
  ].filter(Boolean);
  const customerLines = [quote.phone, quote.email].filter(Boolean);
  const hasTierPricing = visibleItems.some((item) => itemPrices(item).length > 1);
  const quantities = Array.from(new Set(visibleItems.flatMap((item) => itemPrices(item)
    .filter((row) => Number(row.quantity) > 0)
    .map((row) => Number(row.quantity))))).sort((a, b) => a - b);
  const productGroups = Array.from({ length: Math.ceil(visibleItems.length / 2) }, (_, index) => visibleItems.slice(index * 2, index * 2 + 2));
  const firstPageTermLimit = visibleItems.length <= 1
    ? (foreign ? 2 : 3)
    : visibleItems.length === 2
      ? 0
      : 0;
  const firstTerms = enabledTerms.slice(0, firstPageTermLimit);
  const remainingTerms = enabledTerms.slice(firstPageTermLimit);
  const continuationTermSize = foreign ? 3 : 5;
  const remainingTermGroups = Array.from(
    { length: Math.ceil(remainingTerms.length / continuationTermSize) },
    (_, index) => remainingTerms.slice(index * continuationTermSize, (index + 1) * continuationTermSize),
  );
  const pageCount = Math.max(1, productGroups.length) + remainingTermGroups.length;
  const renderTerm = (term, index) => {
    const standard = fixedTerms.find((item) => item.label === term.label);
    const translated = term.contentForeign || standard?.foreign?.[quote.languageKey] || "";
    return <div className="classic-term" key={term.id || index}><b>{term.label}</b><p>{term.content}</p>{foreign && translated && <em>{translated}</em>}</div>;
  };
  const pageHeader = (continuation = false) => <header className={`ref-quote-header ${continuation ? "compact" : ""}`}>
    <div className="ref-quote-title"><h1>{continuation ? "QUOTATION" : "QUOTATION"}</h1><span>{continuation ? "续页 / CONTINUED" : "报价单"}</span></div>
    <div className="ref-company">
      {systemSettings.showLogoInDocuments !== false && systemSettings.logoUrl && <img src={systemSettings.logoUrl} alt="" />}
      <div>{companyName && <strong>{companyName}</strong>}{systemSettings.description && <span>{systemSettings.description}</span>}{companyContacts.length > 0 && <small>{companyContacts.join(" · ")}</small>}{quote.shippingOrigin && <small className="ref-shipping-origin">发货地：{quote.shippingOrigin}</small>}</div>
    </div>
  </header>;
  const renderProductTable = (items, pageIndex) => <>
    <div className="ref-product-divider"><span>PRODUCTS / 产品列表</span></div>
    <div className="ref-products">
    {items.map((item, offset) => {
      const index = pageIndex * 2 + offset;
      const meta = [["尺寸", item.dimensions], ["颜色", item.color], ["工艺", item.specialProcess], ["包装", item.packaging]].filter(([, value]) => String(value || "").trim());
      const prices = itemPrices(item);
      return <section className="ref-product" key={item.id || index}>
        <header className="ref-product-head">
          <b className="ref-product-index">{String(index + 1).padStart(2, "0")}</b>
          <div className="ref-product-badge">{item.showImage && item.imageUrl ? <img src={item.imageUrl} alt="" /> : String.fromCharCode(65 + (index % 26))}</div>
          <div><h3>{item.productName}{foreign && item.productNameForeign && <em>{item.productNameForeign}</em>}</h3>{item.sampleNo && item.sampleNo.trim() !== item.productName.trim() && <b className="ref-product-number">编号：{item.sampleNo}</b>}{meta.length > 0 && <p>{meta.map(([name, value]) => `${name}：${value}`).join(" ｜ ")}</p>}</div>
        </header>
        <div className="ref-price-table"><div className="ref-price-row head"><b>QUANTITY<small>数量</small></b><b>UNIT PRICE<small>单价</small></b><b>LEAD TIME<small>工期</small></b><b>SUBTOTAL<small>小计</small></b></div>
          {prices.map((row, rowIndex) => <div className="ref-price-row" key={rowIndex}><span>{Number(row.quantity).toLocaleString()} pcs</span><strong className={rowIndex === prices.length - 1 ? "best" : ""}>{money(row.unitPrice, quote.currency, quote.languageKey)}</strong><span>{row.deliveryDays ? `${row.deliveryDays} days` : ""}</span><b>{money(Number(row.quantity) * Number(row.unitPrice), quote.currency, quote.languageKey)}</b></div>)}
        </div>
        {item.notes && <p className="ref-product-note">{item.notes}</p>}
      </section>;
    })}
    </div>
  </>;
  return <div className={`quotation-document template-classic language-${quote.languageKey}`}>
    {(productGroups.length ? productGroups : [[]]).map((items, pageIndex) => <article className={`quotation-paper classic-paper ${pageIndex > 0 ? "classic-continuation-page" : ""}`} key={`products-${pageIndex}`}>
      {pageIndex === 0 && pageHeader(false)}
      {pageIndex === 0 && <>
        <section className="ref-meta-grid">
          {(quote.contactName || quote.customerName || customerLines.length > 0 || quote.address) && <div className="ref-meta-card"><small>CUSTOMER / 客户信息</small>{quote.contactName && <strong>{quote.contactName}</strong>}{quote.customerName && <b>{quote.customerName}</b>}{customerLines.length > 0 && <span>{customerLines.join(" · ")}</span>}{quote.address && <span>{quote.address}</span>}</div>}
          <div className="ref-meta-card"><small>QUOTATION INFO / 报价信息</small><div className="ref-meta-facts"><p><span>编号 No.</span><b>{quote.quote_no}</b></p>{quoteFacts.map(([name, value]) => <p key={name}><span>{name}</span><b>{value}</b></p>)}</div></div>
        </section>
      </>}
      {items.length > 0 && renderProductTable(items, pageIndex)}
      {pageIndex === productGroups.length - 1 && <>
        <div className="ref-closing">
        {!hasTierPricing && totals.total > 0 && <section className="ref-amount-summary">
          {totals.merchandise > 0 && <p><span>商品金额 / Merchandise</span><b>{money(totals.merchandise, quote.currency, quote.languageKey)}</b></p>}
          {quote.fees.filter((fee) => fee.enabled && Number(fee.amount) !== 0).map((fee) => <p key={fee.id || fee.name}><span>{fee.name}</span><b>{money(fee.amount, quote.currency, quote.languageKey)}</b></p>)}
          {Number(quote.taxRate) > 0 && <p><span>税费 / Tax ({quote.taxRate}%)</span><b>{money(totals.tax, quote.currency, quote.languageKey)}</b></p>}
          <strong><span>{label("total")}</span><b>{money(totals.total, quote.currency, quote.languageKey)}</b></strong>
          {Number(quote.depositRate) > 0 && <small>预计收款 {money(totals.deposit, quote.currency, quote.languageKey)} · 尾款 {money(totals.balance, quote.currency, quote.languageKey)}</small>}
        </section>}
        {hasTierPricing && <section className="classic-reference"><b>数量阶梯参考报价</b><span>最终金额根据双方确认的产品、数量档位及附加费用计算。</span></section>}
        {firstTerms.length > 0 && <section className="ref-terms"><h2>TERMS & CONDITIONS / 商务条款</h2><div>{firstTerms.map(renderTerm)}</div></section>}
        {remainingTermGroups.length === 0 && quote.customerNotes && <section className="ref-note"><b>Note / 备注：</b>{quote.customerNotes}</section>}
        {remainingTermGroups.length === 0 && afterSales.length > 0 && <section className="ref-contact"><div><strong>{systemSettings.afterSalesName || "售后服务"}</strong><span>After-sales Service / 售后服务</span></div><p>{afterSales.slice(1).map((value) => <span key={value}>{value}</span>)}</p></section>}
        </div>
      </>}
      <footer><span>{quote.quote_no}</span><span>{String(pageIndex + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</span></footer>
    </article>)}
    {remainingTermGroups.map((group, groupIndex) => <article className="quotation-paper classic-paper classic-terms-page classic-continuation-page" key={`terms-${groupIndex}`}>
      <section className="ref-terms"><h2>TERMS & CONDITIONS / 商务条款</h2><div>{group.map(renderTerm)}</div></section>
      {groupIndex === remainingTermGroups.length - 1 && quote.customerNotes && <section className="ref-note"><b>Note / 备注：</b>{quote.customerNotes}</section>}
      {groupIndex === remainingTermGroups.length - 1 && afterSales.length > 0 && <section className="ref-contact"><div><strong>{systemSettings.afterSalesName || "售后服务"}</strong><span>After-sales Service / 售后服务</span></div><p>{afterSales.slice(1).map((value) => <span key={value}>{value}</span>)}</p></section>}
      <footer><span>{quote.quote_no}</span><span>{String(Math.max(1, productGroups.length) + groupIndex + 1).padStart(2, "0")} / {String(pageCount).padStart(2, "0")}</span></footer>
    </article>)}
  </div>;
  /* Previous classic structure intentionally removed from rendering. */
  return <div className={`quotation-document template-classic language-${quote.languageKey}`}>
    <article className="quotation-paper classic-paper">
      <header className="classic-header">
        <div className="classic-brand">
          {systemSettings.showLogoInDocuments !== false && systemSettings.logoUrl && <img src={systemSettings.logoUrl} alt="" />}
          <div>{companyName && <strong>{companyName}</strong>}<h1>{label("title")}</h1>{companyLines.length > 0 && <small>{companyLines.join(" · ")}</small>}</div>
        </div>
        <div className="classic-number"><small>QUOTATION NO.</small><b>{quote.quote_no}</b></div>
      </header>

      {quoteFacts.length > 0 && <section className="classic-facts quote-facts">{quoteFacts.map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}</section>}
      {(customerFacts.length > 0 || quote.address) && <section className="classic-customer">
        {customerFacts.length > 0 && <div className="classic-facts">{customerFacts.map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}</div>}
        {quote.address && <p><small>地址 / Address</small><b>{quote.address}</b></p>}
      </section>}

      {visibleItems.length > 0 && <section className="classic-products">
        <div className="classic-section-title"><span>PRODUCT & PRICE</span><h2>产品与报价</h2></div>
        <div className="classic-table" style={{ "--tier-count": Math.max(1, quantities.length) }}>
          <div className="classic-table-head"><b>款式与图片</b><b>产品规格</b>{quantities.map((qty) => <b key={qty}>{qty}个</b>)}</div>
          {visibleItems.map((item, index) => {
            const specs = [["尺寸", item.dimensions], ["颜色", item.color], ["工艺", item.specialProcess]].filter(([, value]) => String(value || "").trim());
            return <div className="classic-product-row" key={item.id || index}>
              <div className="classic-product-identity">
                {item.showImage && item.imageUrl && <img src={item.imageUrl} alt="" />}
                <span><small>STYLE {String(index + 1).padStart(2, "0")}</small><strong>{item.productName}</strong>{foreign && item.productNameForeign && <em>{item.productNameForeign}</em>}</span>
              </div>
              <div className="classic-specs">{specs.map(([name, value]) => <p key={name}><small>{name}</small><b>{value}</b></p>)}</div>
              {quantities.map((qty) => {
                const row = itemPrices(item).find((price) => Number(price.quantity) === qty);
                return <div className="classic-price" key={qty}>{row && <><strong>{money(row.unitPrice, quote.currency, quote.languageKey)}</strong>{row.deliveryDays && <small>{row.deliveryDays}天生产工期</small>}</>}</div>;
              })}
              {(item.packaging || item.notes) && <div className="classic-product-extra">{item.packaging && <span><small>包装</small>{item.packaging}</span>}{item.notes && <span><small>备注</small>{item.notes}</span>}</div>}
            </div>;
          })}
        </div>
      </section>}

      <section className="classic-bottom">
        {enabledTerms.length > 0 && <div className="classic-terms"><div className="classic-section-title"><span>TERMS</span><h2>商务条款</h2></div>{enabledTerms.slice(0, 3).map(renderTerm)}</div>}
        <aside className="classic-summary">
          {hasTierPricing ? <div className="classic-tier-note"><small>数量阶梯参考报价</small><b>最终金额根据确认档位计算</b></div> : <>
            {totals.merchandise > 0 && <span><small>商品金额</small><b>{money(totals.merchandise, quote.currency, quote.languageKey)}</b></span>}
            {Number(quote.shippingFee) > 0 && <span><small>运费</small><b>{money(quote.shippingFee, quote.currency, quote.languageKey)}</b></span>}
            {totals.total > 0 && <strong><small>{label("total")}</small><b>{money(totals.total, quote.currency, quote.languageKey)}</b></strong>}
          </>}
        </aside>
      </section>
      {(quote.customerNotes || afterSales.length > 0) && <section className="classic-service">{quote.customerNotes && <p><b>客户备注 / Notes</b><span>{quote.customerNotes}</span></p>}{afterSales.length > 0 && <p><b>售后联系 / After-sales</b><span>{afterSales.join(" · ")}</span></p>}</section>}
      <footer><span>{quote.quote_no}</span><span>01 / 01</span></footer>
    </article>
  </div>;
}

function Preview({ quote, totals, systemSettings }) {
  if (quote.templateKey === "catalog") return <CatalogPreview quote={quote} totals={totals} systemSettings={systemSettings} />;
  if (quote.templateKey === "compare") return <ComparePreview quote={quote} totals={totals} systemSettings={systemSettings} />;
  if (quote.templateKey === "confirm") return <CuteHanddrawnPreview quote={quote} totals={totals} systemSettings={systemSettings} />;
  return <ClassicPreview quote={quote} totals={totals} systemSettings={systemSettings} />;
  /* Legacy classic layout kept temporarily for compatibility while the new layout settles. */
  const foreign = quote.languageKey !== "zh" ? words[quote.languageKey] : null;
  const label = (key) =>
    foreign ? `${words.zh[key]} / ${foreign[key]}` : words.zh[key];
  const enabledTerms = quote.terms.filter((t) => t.enabled);
  const tierCount = quote.items.reduce((sum, item) => sum + (item.priceTiers?.length || 0), 0);
  const firstPageTermLimit = foreign
    ? Math.max(1, 3 - Math.max(0, quote.items.length - 2) - Math.ceil(tierCount / 3))
    : Math.max(2, 5 - Math.max(0, quote.items.length - 1) - Math.ceil(tierCount / 4));
  const firstPageTerms = enabledTerms.slice(0, firstPageTermLimit);
  const remainingTerms = enabledTerms.slice(firstPageTermLimit);
  const continuationSize = foreign ? 3 : 5;
  const termGroups = Array.from({ length: Math.ceil(remainingTerms.length / continuationSize) }, (_, index) => remainingTerms.slice(index * continuationSize, (index + 1) * continuationSize));
  const pageCount = 1 + termGroups.length;
  const renderTerm = (term, index) => {
    const standard = fixedTerms.find((x) => x.label === term.label);
    const translated = term.contentForeign || standard?.foreign?.[quote.languageKey] || "";
    return <p key={term.id || `${term.label}-${index}`}><b>{term.label}：</b>{term.content}{foreign && translated && <em>{translated}</em>}</p>;
  };
  const contactDetails = [quote.phone, quote.email, quote.address].filter(Boolean);
  return (
    <div className={`quotation-document template-${quote.templateKey} language-${quote.languageKey}`}>
    <article className="quotation-paper quotation-page-main">
      <header>
        <div>
          <small>ZHIYUAN · BAG PRODUCT SOLUTIONS</small>
          <h1>{label("title")}</h1>
          <b>{quote.quote_no}</b>
        </div>
        <div className="quote-company">
          <strong>知源箱包</strong>
          <span>专业箱包产品与供应链服务</span>
        </div>
      </header>
      <section className="quote-meta">
        <span>
          <small>联系人 / Contact</small>
          <b>{quote.contactName || quote.customerName || "—"}</b>
          {quote.contactName && quote.customerName && <em>{quote.customerName}</em>}
        </span>
        <span>
          <small>公司 / Company</small>
          <b>{quote.customerName || "—"}</b>
        </span>
        <span>
          <small>{label("date")} / {label("valid")}</small>
          <b>{quote.quoteDate} / {quote.validUntil || "—"}</b>
        </span>
        <span>
          <small>币种 / Currency</small>
          <b>{quote.currency}</b>
        </span>
      </section>
      {contactDetails.length > 0 && (
        <div className="quote-contact-line">{contactDetails.join(" · ")}</div>
      )}
      <div className="quote-products quote-product-cards">
        {quote.items.map((item, index) => {
          const priceRows = [
            { quantity: item.quantity, unitPrice: item.unitPrice, deliveryDays: item.deliveryDays, primary: true },
            ...(item.priceTiers || []),
          ].filter((row) => Number(row.quantity) > 0 || Number(row.unitPrice) > 0 || row.deliveryDays);
          return (
            <section className="quote-product-card" key={item.id || index}>
              <header className="quote-product-card-head">
                <div className="quote-product-info">
                {item.showImage && (
                  <div className="quote-product-image">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" />
                    ) : (
                      <span className="quote-image-placeholder">产品图</span>
                    )}
                  </div>
                )}
                <div>
                  <b>{item.productName}</b>
                  {foreign && (
                    <strong>
                      {item.productNameForeign || item.productName}
                    </strong>
                  )}
                  {item.sampleNo && <small>{item.sampleNo}</small>}
                </div>
              </div>
                <strong className="quote-product-index">款式 {String(index + 1).padStart(2, "0")}</strong>
              </header>
              <div className="quote-product-specs">
                <span><small>颜色</small><b>{item.color || "—"}</b></span>
                <span><small>尺寸</small><b>{item.dimensions || "—"}</b></span>
                <span><small>特殊工艺</small><b>{item.specialProcess || "—"}</b></span>
                <span><small>包装</small><b>{item.packaging || "—"}</b></span>
              </div>
              {item.notes && <div className="quote-product-note"><small>产品备注</small><span>{item.notes}</span></div>}
              <div className="quote-price-matrix">
                <div className="quote-price-head"><b>数量</b><b>报价单价</b><b>生产工期</b><b>参考金额</b></div>
                {priceRows.map((row, rowIndex) => (
                  <div className={row.primary ? "primary" : ""} key={rowIndex}>
                    <span>{row.quantity || 0}{item.unit || "个"}</span>
                    <strong>{money(row.unitPrice, quote.currency, quote.languageKey)}</strong>
                    <span>{row.deliveryDays ? `${row.deliveryDays}天` : "待确认"}</span>
                    <b>{money(Number(row.quantity || 0) * Number(row.unitPrice || 0), quote.currency, quote.languageKey)}</b>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <section className="quote-total-panel">
        <div><small>商品金额</small><b>{money(totals.merchandise, quote.currency, quote.languageKey)}</b></div>
        {Number(quote.shippingFee) > 0 && <div><small>运费</small><b>{money(quote.shippingFee, quote.currency, quote.languageKey)}</b></div>}
        <strong><small>{label("total")}</small><b>{quote.currency} {money(totals.total, quote.currency, quote.languageKey)}</b></strong>
        <em>订金 {money(totals.deposit, quote.currency, quote.languageKey)} · 尾款 {money(totals.balance, quote.currency, quote.languageKey)}</em>
      </section>
      {firstPageTerms.length > 0 && <section className="quote-terms-compact">
        <h3>{label("terms")}</h3>
        {firstPageTerms.map(renderTerm)}
      </section>}
      {termGroups.length === 0 && <section className="quote-after-sales-print compact">
        <b>售后联系 / After-sales</b>
        <span>{[quote.complaintContact, quote.complaintPhone, quote.complaintEmail, quote.complaintWechat].filter(Boolean).join(" · ") || "—"}</span>
      </section>}
      <footer><span>{quote.quote_no}</span><span>01 / {String(pageCount).padStart(2,"0")}</span></footer>
    </article>
    {termGroups.map((group, groupIndex) => <article className="quotation-paper quotation-page-terms" key={groupIndex}>
      <header className="quote-continuation-head"><div><small>ZHIYUAN · TERMS</small><h2>{label("terms")}</h2></div><b>{quote.quote_no}</b></header>
      <section className="quote-terms-full">
          <h3>{label("terms")}</h3>
          {group.map(renderTerm)}
          {enabledTerms.length === 0 && <p className="quote-empty-copy">本报价单未设置商务条款。</p>}
          {groupIndex === termGroups.length - 1 && quote.customerNotes && (
            <p>
              <b>{label("note")}：</b>
              {quote.customerNotes}
            </p>
          )}
      </section>
      {groupIndex === termGroups.length - 1 && <section className="quote-after-sales-print">
        <b>售后联系 / After-sales</b>
        <span>{[quote.complaintContact, quote.complaintPhone, quote.complaintEmail, quote.complaintWechat].filter(Boolean).join(" · ") || "—"}</span>
      </section>}
      <footer><span>{quote.quote_no}</span><span>{String(groupIndex + 2).padStart(2,"0")} / {String(pageCount).padStart(2,"0")}</span></footer>
    </article>)}
    </div>
  );
}

export default function QuotationWorkspace({ systemSettings = {} }) {
  const [list, setList] = useState([]);
  const [quote, setQuote] = useState(null);
  const [samples, setSamples] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [previewLarge, setPreviewLarge] = useState(false);
  const [mobileView, setMobileView] = useState("edit");
  const loadList = async (preferred) => {
    const rows = await api(
      `/quotations?keyword=${encodeURIComponent(keyword)}&status=all`,
    );
    setList(rows);
    const id = preferred || quote?.id || rows[0]?.id;
    if (id) {
      const mapped = mapQuote(await api(`/quotations/${id}`));
      setQuote(mapped);
      setSavedSnapshot(JSON.stringify(mapped));
    }
  };
  useEffect(() => {
    loadList().catch((e) => setNotice(e.message));
    Promise.all([api("/sample-quotes"), api("/customers")])
      .then(([sampleRows, customerRows]) => {
        setSamples(sampleRows);
        setCustomers(customerRows);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    const timer = setTimeout(
      () => loadList().catch((e) => setNotice(e.message)),
      250,
    );
    return () => clearTimeout(timer);
  }, [keyword]);
  const totals = useMemo(() => {
    const merchandise =
      quote?.items.reduce(
        (sum, i) =>
          sum +
          Number(i.quantity || 0) *
            Number(i.unitPrice || 0) *
            (1 - Number(i.discountRate || 0) / 100),
        0,
      ) || 0;
    const extras =
      quote?.fees
        .filter((f) => f.enabled)
        .reduce((sum, f) => sum + Number(f.amount || 0), 0) || 0;
    const subtotal =
      Math.max(0, merchandise - Number(quote?.orderDiscount || 0)) +
      Number(quote?.shippingFee || 0) +
      extras;
    const tax = (subtotal * Number(quote?.taxRate || 0)) / 100;
    const total = subtotal + tax;
    const deposit = (total * Number(quote?.depositRate || 0)) / 100;
    return { merchandise, tax, total, deposit, balance: total - deposit };
  }, [quote]);
  const isDirty = Boolean(quote && savedSnapshot && JSON.stringify(quote) !== savedSnapshot);
  const patch = (field, value) => setQuote((q) => ({ ...q, [field]: value }));
  const itemPatch = (index, field, value) =>
    patch(
      "items",
      quote.items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  const chooseCustomer = (name) => {
    const customer = customers.find((item) => item.name === name);
    patch("customerName", name);
    if (!customer) return;
    setQuote((current) => ({
      ...current,
      customerName: customer.name,
      contactName: customer.contact_name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      currency: customer.currency || current.currency,
    }));
  };
  const uploadItemImage = (index, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        setBusy(true);
        const uploaded = await api("/uploads/images", {
          method: "POST",
          body: JSON.stringify({ dataUrl: reader.result }),
        });
        itemPatch(index, "imageUrl", uploaded.url);
        setNotice("产品图片已替换");
      } catch (error) {
        setNotice(error.message);
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  };
  const create = async () => {
    if (isDirty && !window.confirm("当前报价单有未保存修改。确定放弃修改并新建吗？")) return;
    const q = await api("/quotations", { method: "POST", body: "{}" });
    await loadList(q.id);
  };
  const save = async () => {
    try {
      const missing = [];
      if (!quote.customerName?.trim()) missing.push("客户公司");
      if (!quote.quoteDate) missing.push("报价日期");
      if (!quote.validUntil) missing.push("有效期");
      if (!quote.currency) missing.push("币种");
      if (!quote.items.length) missing.push("至少一个产品");
      quote.items.forEach((item, index) => {
        if (!item.productName?.trim()) missing.push(`第${index + 1}款产品名称`);
        if (!(Number(item.quantity) > 0)) missing.push(`第${index + 1}款数量`);
        if (!(Number(item.unitPrice) > 0) && !(item.priceTiers || []).some((tier) => Number(tier.unitPrice) > 0)) missing.push(`第${index + 1}款报价单价或阶梯报价`);
      });
      if (missing.length) {
        window.alert(`保存前请填写以下必填内容：\n\n${[...new Set(missing)].map((x) => `• ${x}`).join("\n")}`);
        return false;
      }
      const hasLoss = quote.items.some((item) => {
        const unitCost = Number(item.costSnapshot?.result?.unitCost || 0);
        const sellingPrice =
          Number(item.unitPrice || 0) *
          (1 - Number(item.discountRate || 0) / 100);
        return unitCost > 0 && sellingPrice < unitCost;
      });
      if (
        quote.status === "已报价" &&
        hasLoss &&
        !window.confirm("存在低于成本的产品。确认仍要标记为已报价吗？")
      )
        return false;
      setBusy(true);
      const updated = await api(`/quotations/${quote.id}`, {
        method: "PUT",
        body: JSON.stringify(quote),
      });
      const mapped = mapQuote(updated);
      setQuote(mapped);
      setSavedSnapshot(JSON.stringify(mapped));
      const rows = await api(`/quotations?keyword=${encodeURIComponent(keyword)}&status=all`);
      setList(rows);
      setNotice("报价单已保存");
      window.alert(`报价单 ${updated.quote_no} 已保存，并已加入最近报价单列表。`);
      return true;
    } catch (e) {
      setNotice(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const addSample = async (id) => {
    if (!id) return;
    try {
      setBusy(true);
      setQuote(
        mapQuote(
          await api(`/quotations/${quote.id}/items/from-sample/${id}`, {
            method: "POST",
            body: "{}",
          }),
        ),
      );
      setNotice("核价样品、客户资料和报价信息已同步");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const moveItem = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= quote.items.length) return;
    const items = [...quote.items];
    [items[index], items[target]] = [items[target], items[index]];
    patch("items", items);
  };
  const openQuotation = async (id) => {
    if (id === quote.id) return;
    if (isDirty && !window.confirm("当前报价单有未保存修改。确定放弃修改并切换吗？")) return;
    const mapped = mapQuote(await api(`/quotations/${id}`));
    setQuote(mapped);
    setSavedSnapshot(JSON.stringify(mapped));
  };
  const remove = async () => {
    if (!confirm("确定删除这张报价单吗？")) return;
    await api(`/quotations/${quote.id}`, { method: "DELETE" });
    setQuote(null);
    await loadList();
  };
  if (!quote)
    return (
      <>
        <header>
          <div>
            <p>QUOTATION CENTER</p>
            <h1>报价单</h1>
          </div>
          <button className="primary" onClick={create}>
            + 新建报价单
          </button>
        </header>
        <section className="panel empty">暂无报价单，点击右上角新建。</section>
      </>
    );
  return (
    <>
      <header className="quotation-page-head">
        <div>
          <p>QUOTATION CENTER / MULTILINGUAL</p>
          <h1>报价单</h1>
          <span>客户信息、产品报价、金额条款与多语言成稿集中管理</span>
        </div>
        <div>
          <button onClick={create}>+ 新建</button>
          <button className="danger" onClick={remove}>删除</button>
          <button onClick={save} className="primary" disabled={busy}>
            保存报价单
          </button>
          <button
            onClick={async () => {
              if (await save()) window.setTimeout(() => window.print(), 120);
            }}
          >
            保存并打印 PDF
          </button>
        </div>
      </header>
      {notice && <div className="notice neutral">{notice}</div>}
      <nav className="quotation-mobile-tabs">
        <button onClick={() => setMobileView("list")}>列表</button>
        <button onClick={() => setMobileView("edit")}>编辑</button>
        <button onClick={() => setMobileView("preview")}>预览</button>
      </nav>
      <main className="quotation-workspace">
        <section className={`quotation-editor mobile-${mobileView}`}>
          <section className="quote-edit-card">
            <div className="quote-card-label">
              <i>01</i>
              <div>
                <small>QUOTATION PROFILE</small>
                <b>客户与报价信息</b>
              </div>
              <select
                className="quote-profile-import"
                onChange={(e) => {
                  addSample(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                disabled={busy}
              >
                <option value="">+ 导入已核价样品</option>
                {samples
                  .filter((s) => s.status === "已核价" || s.total_cost)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.sample_no}
                    </option>
                  ))}
              </select>
            </div>
            <header>
              <h2>{quote.quote_no}</h2>
            </header>
            <div className="quote-edit-grid">
              <label>
                客户公司
                <input
                  list="quotation-customer-options"
                  placeholder="输入客户、公司或从客户库选择"
                  value={quote.customerName || ""}
                  onChange={(e) => customers.some((x) => x.name === e.target.value) ? chooseCustomer(e.target.value) : patch("customerName", e.target.value)}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    const matched = customers.find((x) => x.name === value || x.contact_name === value);
                    if (matched) chooseCustomer(matched.name);
                  }}
                />
                <datalist id="quotation-customer-options">
                  {customers.map((customer) => <option value={customer.name} key={customer.id}>{customer.contact_name || customer.name}</option>)}
                  {customers.filter((customer) => customer.contact_name).map((customer) => <option value={customer.contact_name} key={`contact-${customer.id}`}>{customer.name}</option>)}
                </datalist>
              </label>
              {[
                ["contactName", "联系人"],
                ["phone", "电话"],
                ["email", "邮箱"],
              ].map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    value={quote[field] || ""}
                    onChange={(e) => patch(field, e.target.value)}
                  />
                </label>
              ))}
              <label className="full-row">
                地址
                <input value={quote.address || ""} onChange={(e) => patch("address", e.target.value)} />
              </label>
              <label>
                订单跟单员
                <input value={quote.salesperson || ""} onChange={(e) => patch("salesperson", e.target.value)} />
              </label>
              <label>
                报价日期
                <input
                  type="date"
                  value={quote.quoteDate}
                  onChange={(e) => patch("quoteDate", e.target.value)}
                />
              </label>
              <label>
                有效期
                <input
                  type="date"
                  value={quote.validUntil}
                  onChange={(e) => patch("validUntil", e.target.value)}
                />
              </label>
              <label>
                币种
                <select
                  value={quote.currency}
                  onChange={(e) => patch("currency", e.target.value)}
                >
                  {["CNY", "USD", "EUR", "JPY", "KRW"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <section className="quote-edit-card">
            <div className="quote-section-title">
              <div>
                <span className="quote-section-index">02</span>
                <div>
                  <h3>产品与价格</h3>
                  <small>每款产品的图片、规格、数量、交期和客户报价</small>
                </div>
              </div>
              <div>
                <button
                  className="quote-add-action"
                  onClick={() => patch("items", [...quote.items, emptyItem()])}
                >
                  + 手动产品
                </button>
                <small className="manual-product-help">用于添加未经过核价助手的临时产品</small>
              </div>
            </div>
            {quote.items.map((item, index) => (
              <article className="quote-item-editor" key={item.id || index}>
                <div className="quote-item-image">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt="" />
                  ) : (
                    <span>暂无图片</span>
                  )}
                  <label className="quote-image-replace">
                    {item.imageUrl ? "上传替换" : "+ 上传图片"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(e) =>
                        uploadItemImage(index, e.target.files?.[0])
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.showImage}
                      onChange={(e) =>
                        itemPatch(index, "showImage", e.target.checked)
                      }
                    />
                    客户端显示
                  </label>
                </div>
                <div className="quote-item-fields">
                  {[
                    ["productName", "产品名称"],
                    ["color", "颜色"],
                    ["dimensions", "尺寸"],
                    ["specialProcess", "特殊工艺"],
                    ["packaging", "包装要求"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        value={item[field] || ""}
                        onChange={(e) =>
                          itemPatch(index, field, e.target.value)
                        }
                      />
                    </label>
                  ))}
                  {[
                    ["quantity", "数量"],
                    ["unitPrice", "报价单价"],
                    ["deliveryDays", "生产工期（天）"],
                  ].map(([field, label]) => (
                    <label key={field}>
                      {label}
                      <input
                        type="number"
                        step="any"
                        value={item[field] ?? ""}
                        onChange={(e) =>
                          itemPatch(index, field, e.target.value)
                        }
                      />
                    </label>
                  ))}
                  <label className="full-row">
                    产品备注
                    <input
                      value={item.notes || ""}
                      onChange={(e) =>
                        itemPatch(index, "notes", e.target.value)
                      }
                    />
                  </label>
                  <div className="quote-tier-editor">
                  <div className="quote-tier-title">
                    <span><b>阶梯报价</b><small>客户采购数量不同时，可分别设置单价和生产工期</small></span>
                    <button type="button" onClick={() => itemPatch(index, "priceTiers", [...(item.priceTiers || []), { quantity: "", unitPrice: "", deliveryDays: "" }])}>+ 添加报价档位</button>
                  </div>
                  {(item.priceTiers || []).map((tier, tierIndex) => (
                    <div className="quote-tier-row" key={tierIndex}>
                      <label>数量<input type="number" value={tier.quantity ?? ""} onChange={(e) => itemPatch(index, "priceTiers", item.priceTiers.map((x, i) => i === tierIndex ? { ...x, quantity: e.target.value } : x))} /></label>
                      <label>报价单价<input type="number" step="any" value={tier.unitPrice ?? ""} onChange={(e) => itemPatch(index, "priceTiers", item.priceTiers.map((x, i) => i === tierIndex ? { ...x, unitPrice: e.target.value } : x))} /></label>
                      <label>生产工期（天）<input type="number" value={tier.deliveryDays ?? ""} onChange={(e) => itemPatch(index, "priceTiers", item.priceTiers.map((x, i) => i === tierIndex ? { ...x, deliveryDays: e.target.value } : x))} /></label>
                      <button type="button" className="danger" onClick={() => itemPatch(index, "priceTiers", item.priceTiers.filter((_, i) => i !== tierIndex))}>删除</button>
                    </div>
                  ))}
                  </div>
                </div>
                <div className="quote-item-actions">
                  <b>
                    {money(
                      Number(item.quantity) *
                        Number(item.unitPrice) *
                        (1 - Number(item.discountRate || 0) / 100),
                      quote.currency,
                    )}
                  </b>
                  <button className="quote-item-action-button"
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                    title="向前移动"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveItem(index, 1)}
                    disabled={index === quote.items.length - 1}
                    title="向后移动"
                  >
                    ↓
                  </button>
                  <button className="quote-item-action-button"
                    onClick={() =>
                      patch("items", [
                        ...quote.items.slice(0, index + 1),
                        { ...item, id: `copy-${Date.now()}` },
                        ...quote.items.slice(index + 1),
                      ])
                    }
                  >
                    复制
                  </button>
                  <button
                    className="quote-item-action-button danger"
                    onClick={() =>
                      patch(
                        "items",
                        quote.items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    删除
                  </button>
                </div>
                <InternalCost
                  item={item}
                  quotePrice={
                    Number(item.unitPrice) *
                    (1 - Number(item.discountRate || 0) / 100)
                  }
                />
              </article>
            ))}
          </section>
          <section className="quote-edit-card">
            <div className="quote-section-title">
              <div className="quote-section-heading">
                <span className="quote-section-index">03</span>
                <div>
                  <h3>发货与售后</h3>
                  <small>发货费用、发货地和售后投诉联系方式</small>
                </div>
              </div>
              <button
                className="quote-add-action"
                onClick={() =>
                  patch("fees", [
                    ...quote.fees,
                    { name: "新增费用", amount: 0, enabled: true },
                  ])
                }
              >
                + 附加费用
              </button>
            </div>
            <div className="quote-charge-grid">
              <label>
                运费
                <input
                  type="number"
                  value={quote.shippingFee}
                  onChange={(e) => patch("shippingFee", e.target.value)}
                />
              </label>
              <label>
                税率 %
                <input
                  type="number"
                  value={quote.taxRate}
                  onChange={(e) => patch("taxRate", e.target.value)}
                />
              </label>
              <label>
                收款比例 %
                <input
                  type="number"
                  value={quote.depositRate}
                  onChange={(e) => patch("depositRate", e.target.value)}
                />
              </label>
              <label>
                发货地
                <input
                  value={quote.shippingOrigin || ""}
                  onChange={(e) => patch("shippingOrigin", e.target.value)}
                />
              </label>
              <label>
                售后投诉联系人
                <input
                  value={quote.complaintContact || ""}
                  onChange={(e) => patch("complaintContact", e.target.value)}
                />
              </label>
              <label>
                售后联系方式
                <input
                  value={quote.complaintPhone || ""}
                  onChange={(e) => patch("complaintPhone", e.target.value)}
                />
              </label>
              <label>
                售后邮箱
                <input type="email" value={quote.complaintEmail || ""} onChange={(e) => patch("complaintEmail", e.target.value)} />
              </label>
              <label>
                售后微信
                <input value={quote.complaintWechat || ""} onChange={(e) => patch("complaintWechat", e.target.value)} />
              </label>
            </div>
            {quote.fees.map((fee, index) => (
              <div className="quote-custom-row" key={fee.id || index}>
                <input
                  type="checkbox"
                  checked={fee.enabled}
                  onChange={(e) =>
                    patch(
                      "fees",
                      quote.fees.map((f, i) =>
                        i === index ? { ...f, enabled: e.target.checked } : f,
                      ),
                    )
                  }
                />
                <input
                  value={fee.name}
                  onChange={(e) =>
                    patch(
                      "fees",
                      quote.fees.map((f, i) =>
                        i === index ? { ...f, name: e.target.value } : f,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  value={fee.amount}
                  onChange={(e) =>
                    patch(
                      "fees",
                      quote.fees.map((f, i) =>
                        i === index ? { ...f, amount: e.target.value } : f,
                      ),
                    )
                  }
                />
                <button
                  onClick={() =>
                    patch(
                      "fees",
                      quote.fees.filter((_, i) => i !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <div className="quote-live-totals">
              <span>
                <small>商品金额</small>
                <b>{money(totals.merchandise, quote.currency)}</b>
              </span>
              <span>
                <small>报价总额</small>
                <strong>{money(totals.total, quote.currency)}</strong>
              </span>
              <span>
                <small>预付款 / 尾款</small>
                <b>
                  {money(totals.deposit, quote.currency)} /{" "}
                  {money(totals.balance, quote.currency)}
                </b>
              </span>
            </div>
          </section>
          <section className="quote-edit-card">
            <div className="quote-section-title">
              <div className="quote-section-heading">
                <span className="quote-section-index">04</span>
                <div>
                  <h3>商务条款与备注</h3>
                  <small>付款、贸易术语、交期、包装、装运及质量验收</small>
                </div>
              </div>
              <button
                className="quote-add-action"
                onClick={() =>
                  patch("terms", [
                    ...quote.terms,
                    {
                      label: "补充条款",
                      content: "",
                      contentForeign: "",
                      enabled: true,
                    },
                  ])
                }
              >
                + 补充条款
              </button>
            </div>
            <details className="fixed-terms-details">
              <summary className="fixed-terms-toolbar">
              <span>标准条款共 {fixedTerms.length} 项 · 点击展开编辑</span>
              </summary>
              <div className="fixed-terms-content">
            {quote.terms.map((term, index) => (
              <div className="quote-term-row no-toggle" key={term.id || index}>
                <input
                  value={term.label}
                  onChange={(e) =>
                    patch(
                      "terms",
                      quote.terms.map((t, i) =>
                        i === index ? { ...t, label: e.target.value } : t,
                      ),
                    )
                  }
                />
                <textarea
                  value={term.content || ""}
                  onChange={(e) =>
                    patch(
                      "terms",
                      quote.terms.map((t, i) =>
                        i === index ? { ...t, content: e.target.value } : t,
                      ),
                    )
                  }
                />
                <textarea
                  value={term.contentForeign || ""}
                  placeholder={fixedTerms.find((x) => x.label === term.label)?.foreign?.[quote.languageKey] || "外语内容（切换右侧语言可查看默认译文）"}
                  onChange={(e) =>
                    patch(
                      "terms",
                      quote.terms.map((t, i) =>
                        i === index
                          ? { ...t, contentForeign: e.target.value }
                          : t,
                      ),
                    )
                  }
                />
                <button
                  onClick={() =>
                    patch(
                      "terms",
                      quote.terms.filter((_, i) => i !== index),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
              </div>
            </details>
            <label className="quote-notes">
              客户可见备注
              <textarea
                value={quote.customerNotes}
                onChange={(e) => patch("customerNotes", e.target.value)}
              />
            </label>
            <label className="quote-notes internal">
              内部备注（不会打印）
              <textarea
                value={quote.internalNotes}
                onChange={(e) => patch("internalNotes", e.target.value)}
              />
            </label>
          </section>
        </section>
        <aside className={`quotation-side-rail mobile-${mobileView}`}>
          <section className="quotation-review-strip">
            <div>
              <small>当前报价</small>
              <b>{quote.quote_no}</b>
              <span className={`quote-save-state ${isDirty ? "dirty" : "saved"}`}>{isDirty ? "有未保存修改" : "已保存"}</span>
            </div>
            <span>
              <small>款式</small>
              <strong>{quote.items.length}</strong>
            </span>
            <span>
              <small>总数量</small>
              <strong>
                {quote.items.reduce(
                  (sum, item) => sum + Number(item.quantity || 0),
                  0,
                )}
              </strong>
            </span>
            <span>
              <small>报价总额</small>
              <strong>{money(totals.total, quote.currency)}</strong>
            </span>
          </section>
          <section className={`quotation-preview mobile-${mobileView}`}>
            <div className="quotation-side-title preview-heading">
              <div><small>LIVE A4 PREVIEW</small><h3>报价单预览</h3></div>
              <div className="preview-controls">
              <select value={quote.templateKey} onChange={(e) => patch("templateKey", e.target.value)}>
                {Object.entries(templateName).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
              </select>
              <select value={quote.languageKey} onChange={(e) => patch("languageKey", e.target.value)}>
                {Object.entries(languageName).map(([k, v]) => <option value={k} key={k}>{v}</option>)}
              </select>
              <button type="button" title="重新渲染当前报价" onClick={() => setQuote((current) => ({ ...current }))}>刷新</button>
              <button type="button" onClick={() => setPreviewLarge(true)}>大图查看</button>
              </div>
            </div>
            <div className="preview-template-help">{templateHelp[quote.templateKey]}</div>
            <div className="quotation-preview-stage"><Preview quote={quote} totals={totals} systemSettings={systemSettings} /></div>
            {quote.items.some((item) => Number(item.unitPrice) <= 0 && !(item.priceTiers || []).some((tier) => Number(tier.unitPrice) > 0)) && <div className="quote-preview-warning">有产品尚未填写报价，保存或打印前需要补充。</div>}
          </section>
          <section className={`quotation-list mobile-${mobileView}`}>
            <div className="quotation-side-title">
              <div>
                <small>QUOTATION ARCHIVE</small>
                <h3>报价单列表</h3>
              </div>
              <b>最近 {list.length} 张</b>
            </div>
            <div className="quotation-list-filters">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索编号、客户或产品"
              />
            </div>
            <div className="quotation-list-items">
              {list.length === 0 && <div className="quotation-list-empty">没有匹配的报价单</div>}
              {list.map((row) => (
                <button
                  className={row.id === quote.id ? "active" : ""}
                  key={row.id}
                  onClick={() => openQuotation(row.id)}
                >
                  <span className="quote-list-customer"><b>{row.contact_name || row.customer_name || "未填写联系人"}</b><small>{row.contact_name && row.customer_name ? row.customer_name : "—"}</small></span>
                  <span className="quote-list-number"><b>{row.quote_no}</b><small>{row.item_count}款 · {row.id === quote.id ? quote.items.reduce((sum,item)=>sum+Number(item.quantity||0),0) : (row.quantity || 0)}个</small></span>
                  <span className="quote-list-date"><small>报价日期</small><b>{row.quote_date || row.created_at?.slice(0, 10)}</b></span>
                  <span className="quote-list-money"><small>{row.id === quote.id ? (isDirty ? "未保存金额" : "当前报价") : "报价总额"}</small><b>{money(row.id === quote.id ? totals.total : row.total_price, row.currency)}</b></span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </main>
      {previewLarge && (
        <div className="quotation-preview-modal" role="dialog" aria-modal="true" onClick={() => setPreviewLarge(false)}>
          <button className="quotation-preview-close" onClick={() => setPreviewLarge(false)}>×</button>
          <div onClick={(e) => e.stopPropagation()}><Preview quote={quote} totals={totals} systemSettings={systemSettings} /></div>
        </div>
      )}
    </>
  );
}

function InternalCost({ item, quotePrice }) {
  const result = item.costSnapshot?.result;
  if (!result)
    return <div className="quote-cost-empty">手动产品暂无内部核价快照</div>;
  const unit = Number(result.unitCost) || 0;
  const profit = quotePrice - unit;
  return (
    <details open
      className={
        profit < 0 ? "quote-internal-cost loss" : "quote-internal-cost"
      }
    >
      <summary>
        内部核价 · 单包成本 {money(unit)} · 利润 {money(profit)} · 利润率{" "}
        {quotePrice ? ((profit / quotePrice) * 100).toFixed(1) : 0}%
      </summary>
      <div>
        <span>
          布料{" "}
          {money(
            Number(result.fabricCost) / Number(result.productionQuantity || 1),
          )}
        </span>
        <span>
          五金配件{" "}
          {money(
            Number(result.accessoryCost) /
              Number(result.productionQuantity || 1),
          )}
        </span>
        <span>加工 {money(result.processingUnit)}</span>
        <span>包装 {money(result.packagingUnit)}</span>
        <span>物流 {money(result.logisticsUnit)}</span>
        <span>裁剪 {money(result.cuttingUnit)}</span>
      </div>
      {profit < 0 && <b>当前报价低于成本，发布前必须确认。</b>}
    </details>
  );
}
