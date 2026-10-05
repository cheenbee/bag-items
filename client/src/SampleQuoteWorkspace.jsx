import { useEffect, useRef, useState } from "react";
import { api } from "./api-client.js";
const money = (value) => `¥${Number(value || 0).toFixed(2)}`;
const toDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
const show = (value) => (value === "" || value == null ? "—" : value);
const number = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const fixed = (value, digits = 2) => number(value).toFixed(digits);

function PackingPreview({ material }) {
  const scale = 3;
  if (!material)
    return (
      <div className="archive-empty packing-tab-empty">
        暂无可显示的排料数据
      </div>
    );
  const pieces = Array.isArray(material.pieces) ? material.pieces : [];
  return (
    <div className="sample-packing-scroll">
      <div
        className="sample-packing-canvas"
        style={{
          width: Math.max(
            460,
            number(
              material.usedLengthCm,
              number(material.layoutUsedLengthM) * 100,
            ) * scale,
          ),
          height: Math.max(180, number(material.usableWidthCm, 148) * scale),
        }}
      >
        {pieces.map((piece, index) => (
          <span
            key={`${piece.partId}-${piece.instance}-${index}`}
            style={{
              left: piece.y * scale,
              top: piece.x * scale,
              width: piece.height * scale,
              height: piece.width * scale,
            }}
          >
            <b>{piece.name}</b>
            <small>
              {piece.width}×{piece.height}
            </small>
          </span>
        ))}
      </div>
    </div>
  );
}

function CostSnapshot({ sample }) {
  const result = sample.result;
  const count = Math.max(1, number(result.productionQuantity, 1));
  const materials = Array.isArray(result.materials) ? result.materials : [];
  const accessories = Array.isArray(result.accessories)
    ? result.accessories
    : [];
  const addedUnit =
    Number(result.packagingUnit) +
    Number(result.logisticsUnit) +
    Number(result.cuttingUnit);
  return (
    <section className="panel detailed-cost-sheet">
      <div className="detailed-cost-head">
        <div>
          <small>COST BREAKDOWN</small>
          <h2>成本与做货价格</h2>
          <span>
            {sample.sample_no} · {result.layoutQuantity}套排版基准 → {count}
            套做货
          </span>
        </div>
        <div>
          <small>单套成本 / 单套做货价</small>
          <strong>
            {money(result.unitCost)} / {money(result.unitQuote)}
          </strong>
        </div>
      </div>
      <section className="comparison-cost-section">
        <div className="cost-comparison-table">
          <div className="comparison-head">
            <span>成本项目</span>
            <span>单套用量</span>
            <span>单套成本</span>
            <span>{count}套用量</span>
            <span>{count}套成本</span>
          </div>
          {materials.map((item) => (
            <article key={`m-${item.materialId}`}>
              <span>
                <b>{item.materialName}</b>
                <small>
                  {result.layoutQuantity}套排版 · 幅宽 {item.usableWidthCm}cm ·
                  利用率 {item.utilizationRate}%
                </small>
              </span>
              <span>{fixed(item.unitUsedLengthM, 3)}m</span>
              <strong>{money(item.unitMaterialCost)}</strong>
              <span>{item.productionUsedLengthM}m</span>
              <strong>{money(item.materialCost)}</strong>
            </article>
          ))}
          {accessories.map((item) => (
            <article key={`a-${item.id}`}>
              <span>
                <b>{item.name}</b>
                <small>
                  配件 · {item.specification || item.unit || "计件"}
                </small>
              </span>
              <span>
                {item.quantityPerSet} {item.unit || "个"}
              </span>
              <strong>{money(item.cost / count)}</strong>
              <span>
                {item.quantity} {item.unit || "个"}
              </span>
              <strong>{money(item.cost)}</strong>
            </article>
          ))}
          <article>
            <span>
              <b>材料损耗</b>
              <small>损耗率 {result.lossRate}%</small>
            </span>
            <span>—</span>
            <strong>{money(result.lossCost / count)}</strong>
            <span>整批</span>
            <strong>{money(result.lossCost)}</strong>
          </article>
          <article>
            <span>
              <b>包装 / 物流 / 裁剪</b>
              <small>
                {money(result.packagingUnit)} / {money(result.logisticsUnit)} /{" "}
                {money(result.cuttingUnit)}
              </small>
            </span>
            <span>1套</span>
            <strong>{money(addedUnit)}</strong>
            <span>{count}套</span>
            <strong>{money(addedUnit * count)}</strong>
          </article>
          <article>
            <span>
              <b>其他费用（整批）</b>
              <small>按做货数量均摊到单包成本</small>
            </span>
            <span>每包</span>
            <strong>{money(number(result.otherCost) / count)}</strong>
            <span>整批</span>
            <strong>{money(result.otherCost)}</strong>
          </article>
          <article className="cost-category-summary">
            <span>
              <b>单包加工费</b>
              <small>样品工序合计或手动填写</small>
            </span>
            <span>1 包</span>
            <strong>{money(result.processingUnit)}</strong>
            <span>{count} 包</span>
            <strong>{money(result.processingUnit * count)}</strong>
          </article>
          <article className="comparison-total">
            <span>
              <b>成本合计</b>
              <small>不含利润</small>
            </span>
            <span>每套</span>
            <strong>{money(result.unitCost)}</strong>
            <span>{count}套</span>
            <strong>{money(result.totalCost)}</strong>
          </article>
          <article className="comparison-quote">
            <span>
              <b>做货价格</b>
              <small>单套利润 {money(result.profitUnit)}</small>
            </span>
            <span>每套</span>
            <strong>{money(result.unitQuote)}</strong>
            <span>{count}套</span>
            <strong>{money(result.totalQuote)}</strong>
          </article>
          <article className="cost-category-summary">
            <span>
              <b>布料成本</b>
              <small>{materials.length} 种布料合计</small>
            </span>
            <span>每包</span>
            <strong>{money(result.fabricCost / count)}</strong>
            <span>{count} 套</span>
            <strong>{money(result.fabricCost)}</strong>
          </article>
          <article className="cost-category-summary">
            <span>
              <b>五金配件成本</b>
              <small>{accessories.length} 项配件合计</small>
            </span>
            <span>每包</span>
            <strong>{money(result.accessoryCost / count)}</strong>
            <span>{count} 套</span>
            <strong>{money(result.accessoryCost)}</strong>
          </article>
        </div>
      </section>
      <div className="cost-analysis">
        <b>成本分析</b>
        <span>
          布料占总成本{" "}
          {result.totalCost
            ? ((result.fabricCost / result.totalCost) * 100).toFixed(1)
            : "0.0"}
          %
        </span>
        <span>
          配件占总成本{" "}
          {result.totalCost
            ? ((result.accessoryCost / result.totalCost) * 100).toFixed(1)
            : "0.0"}
          %
        </span>
        <span>单套布料用量按本次 {count} 套排料结果平均计算</span>
      </div>
    </section>
  );
}

function PackingWorkspace({ sample }) {
  const [selected, setSelected] = useState(
    sample.result?.materials?.[0]?.materialId,
  );
  useEffect(
    () => setSelected(sample.result?.materials?.[0]?.materialId),
    [sample.id, sample.result],
  );
  if (!sample.result)
    return (
      <div className="archive-empty packing-tab-empty">
        完成核价后显示排料图
      </div>
    );
  const materials = Array.isArray(sample.result.materials)
    ? sample.result.materials
    : [];
  if (!materials.length)
    return (
      <div className="archive-empty packing-tab-empty">
        当前核价结果没有可显示的布料排料数据，请重新核价。
      </div>
    );
  const material =
    materials.find((item) => String(item.materialId) === String(selected)) ||
    sample.result.materials[0];
  return (
    <section className="packing-tab-layout">
      <aside>
        {materials.map((item) => (
          <button
            className={
              String(item.materialId) === String(material.materialId)
                ? "active"
                : ""
            }
            key={item.materialId}
            onClick={() => setSelected(item.materialId)}
          >
            <b>{item.materialName}</b>
            <span>单套 {fixed(item.unitUsedLengthM, 3)}m</span>
            <small>
              做货 {item.productionUsedLengthM}m · {money(item.materialCost)}
            </small>
          </button>
        ))}
      </aside>
      <div className="packing-tab-main">
        <header>
          <div>
            <small>{sample.result.layoutQuantity}套排版基准</small>
            <h3>{material.materialName}</h3>
          </div>
          <span>
            幅宽 {material.usableWidthCm}cm · 排版用料{" "}
            {material.layoutUsedLengthM}m · 利用率 {material.utilizationRate}%
          </span>
        </header>
        <PackingPreview material={material} />
      </div>
    </section>
  );
}

function ReadArchive({ sample }) {
  const draft = sample.draft;
  return (
    <>
      <section className="sample-overview">
        <div className="sample-cover">
          {sample.images?.[0] ? (
            <img src={sample.images[0].url} alt="样品" />
          ) : (
            <span>暂无样品图片</span>
          )}
        </div>
        <div className="sample-overview-grid">
          <article>
            <small>样品编号</small>
            <b>{sample.sample_no}</b>
          </article>
          <article>
            <small>排版基准</small>
            <b>{draft.layoutQuantity} 套</b>
          </article>
          <article>
            <small>排料参数</small>
            <b>间隙 {draft.gapCm}cm</b>
          </article>
          <article>
            <small>档案状态</small>
            <b>{sample.status}</b>
          </article>
          <article>
            <small>客户名称</small>
            <b>{show(sample.category)}</b>
          </article>
          <article>
            <small>特殊工艺</small>
            <b>{show(sample.customer_sku)}</b>
          </article>
          <article>
            <small>做货数量</small>
            <b>{draft.productionQuantity} 套</b>
          </article>
          <article>
            <small>颜色</small>
            <b>{show(draft.color)}</b>
          </article>
          <article>
            <small>损耗参数</small>
            <b>{draft.lossRate}%</b>
          </article>
          <article>
            <small>单包加工费</small>
            <b>{money(draft.processingUnit)}</b>
          </article>
          <article>
            <small>单个包包利润</small>
            <b>{money(draft.profitUnit)}</b>
          </article>
          <article>
            <small>其他费用（整批）</small>
            <b>{money(draft.otherCost)}</b>
          </article>
          <article>
            <small>单个包装费</small>
            <b>{money(draft.packagingUnit)}</b>
          </article>
          <article>
            <small>单个物流费</small>
            <b>{money(draft.logisticsUnit)}</b>
          </article>
          <article>
            <small>单个裁剪费</small>
            <b>{money(draft.cuttingUnit)}</b>
          </article>
        </div>
      </section>
      <section className="archive-read-section archive-notes">
        <div className="archive-heading">
          <div>
            <small>NOTES</small>
            <h3>工艺与核价备注</h3>
          </div>
        </div>
        <p>{show(sample.notes)}</p>
      </section>
      <section className="archive-read-section">
        <div className="archive-heading">
          <div>
            <small>PROCESS COST</small>
            <h3>样品工序档案</h3>
          </div>
          <span>
            {draft.processes.length} 道 · {money(draft.processingUnit)}/套
          </span>
        </div>
        {draft.processes.length ? (
          <div className="sample-process-list">
            <div className="sample-table-head">
              <span>做货顺序</span>
              <span>工序名</span>
              <span>操作部位</span>
              <span>单次工价</span>
              <span>单包次数</span>
            </div>
            {draft.processes.map((item, index) => (
              <article key={item.id}>
                <span>{index + 1}</span>
                <span>
                  <b>{show(item.name)}</b>
                </span>
                <span>{show(item.operationPart)}</span>
                <strong>{money(item.unitPrice)}</strong>
                <span>{item.quantityPerSet}</span>
              </article>
            ))}
          </div>
        ) : (
          <div className="archive-empty compact">尚未添加样品工序</div>
        )}
      </section>
      <section className="archive-read-section">
        <div className="archive-heading">
          <div>
            <small>MATERIAL & PARTS</small>
            <h3>布料与裁片</h3>
          </div>
          <span>{draft.materials.length} 种布料</span>
        </div>
        {draft.materials.length ? (
          draft.materials.map((material) => (
            <article className="archive-material-card" key={material.id}>
              <header>
                <div>
                  <b>{material.name}</b>
                  <small>
                    幅宽 {show(material.widthCm)}cm ·{" "}
                    {material.unitPrice == null
                      ? "待填写单价"
                      : `${money(material.unitPrice)}/米`}
                  </small>
                </div>
                <strong>{material.pieces.length} 种裁片</strong>
              </header>
              <div>
                {material.pieces.map((piece) => (
                  <span key={piece.id}>
                    <b>{piece.name}</b>
                    <small>
                      {piece.lengthCm} × {piece.widthCm}cm
                    </small>
                    <i>
                      {piece.quantityPerSet}片/套 ·{" "}
                      {piece.rotatable === false ? "不可旋转" : "可旋转"}
                    </i>
                  </span>
                ))}
              </div>
            </article>
          ))
        ) : (
          <div className="archive-empty">等待AI整理布料和裁片资料</div>
        )}
      </section>
      <section className="archive-read-section">
        <div className="archive-heading">
          <div>
            <small>ACCESSORIES</small>
            <h3>配件与五金</h3>
          </div>
          <span>{draft.accessories.length} 项</span>
        </div>
        {draft.accessories.length ? (
          <div className="archive-accessory-list">
            {draft.accessories.map((item) => (
              <article key={item.id}>
                <div>
                  <b>{item.name}</b>
                  <small>{show(item.specification)}</small>
                </div>
                <span>
                  {item.quantityPerSet} {item.unit}/套
                </span>
                <strong>
                  {item.unitPrice == null ? "待核价" : money(item.unitPrice)}
                </strong>
              </article>
            ))}
          </div>
        ) : (
          <div className="archive-empty">暂无配件资料</div>
        )}
      </section>
      <section className="archive-read-section">
        <div className="archive-heading">
          <div>
            <small>SOURCE FILES</small>
            <h3>AI 已读取资料</h3>
          </div>
          <span>{sample.attachments?.length || 0} 个附件</span>
        </div>
        {sample.attachments?.length ? (
          <div className="archive-files">
            {sample.attachments.map((file) => (
              <a href={file.url} target="_blank" rel="noreferrer" key={file.id}>
                <i>
                  {file.recognition_status === "recognized"
                    ? "✓"
                    : file.mime_type.startsWith("image/")
                      ? "图"
                      : "件"}
                </i>
                <span>
                  <b>{file.name}</b>
                  <small>
                    {file.recognition_summary ||
                      `${(file.size_bytes / 1024).toFixed(1)} KB · 等待识别`}
                  </small>
                </span>
              </a>
            ))}
          </div>
        ) : (
          <div className="archive-empty compact">
            在左侧添加图片或资料后，AI会读取内容并整理到档案
          </div>
        )}
      </section>
    </>
  );
}

function EditArchive({
  sample,
  setSample,
  uploadImages,
  removeImage,
  imageBusy,
  customers,
  workProcesses,
  addCustomer,
  saveSection,
}) {
  const [processMenu, setProcessMenu] = useState(null);
  const draft = sample.draft;
  const setDraft = (field, value) =>
    setSample((current) => ({
      ...current,
      draft: { ...current.draft, [field]: value },
    }));
  const material = (index, field, value) =>
    setDraft(
      "materials",
      draft.materials.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  const piece = (mi, pi, field, value) =>
    material(
      mi,
      "pieces",
      draft.materials[mi].pieces.map((item, i) =>
        i === pi ? { ...item, [field]: value } : item,
      ),
    );
  const accessory = (index, field, value) =>
    setDraft(
      "accessories",
      draft.accessories.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  const process = (index, field, value) =>
    setDraft(
      "processes",
      draft.processes.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    );
  const chooseProcess = (index, value) => {
    const master = workProcesses.find(
      (item) => String(item.id) === String(value),
    );
    if (master)
      setDraft(
        "processes",
        draft.processes.map((item, i) =>
          i === index
            ? {
                ...item,
                workProcessId: master.id,
                name: master.name,
                unitPrice: master.default_unit_price,
              }
            : item,
        ),
      );
  };
  const processChoice = (master) => master.name;
  const chooseProcessText = (index, value) => {
    const keyword = value.trim();
    const master = workProcesses.find(
      (item) =>
        processChoice(item) === keyword ||
        item.name === keyword ||
        item.code === keyword,
    );
    setDraft(
      "processes",
      draft.processes.map((item, i) =>
        i === index
          ? master
            ? {
                ...item,
                workProcessId: master.id,
                processChoice: processChoice(master),
                name: master.name,
                unitPrice: master.default_unit_price,
              }
            : {
                ...item,
                workProcessId: null,
                processChoice: value,
                name: value,
              }
          : item,
      ),
    );
  };
  const selectProcess = (index, master) => {
    setDraft(
      "processes",
      draft.processes.map((item, i) =>
        i === index
          ? {
              ...item,
              workProcessId: master.id,
              processChoice: processChoice(master),
              name: master.name,
              unitPrice: master.default_unit_price,
            }
          : item,
      ),
    );
    setProcessMenu(null);
  };
  const processMatches = (item) => {
    const keyword = String(item.processChoice || item.name || "")
      .trim()
      .toLowerCase();
    return workProcesses
      .filter(
        (master) =>
          !keyword ||
          `${master.code || ""} ${master.name}`.toLowerCase().includes(keyword),
      )
      .slice(0, 8);
  };
  return (
    <div className="sample-edit-form">
      <section>
        <div className="edit-section-title">
          <div>
            <h3>样品图片</h3>
            <small>最新上传的图片将作为样品封面</small>
          </div>
          <label className="sample-image-upload">
            {imageBusy ? "上传中…" : "+ 上传图片"}
            <input
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              disabled={imageBusy}
              onChange={(e) => {
                uploadImages(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {sample.images?.length ? (
          <div className="sample-edit-images">
            {sample.images.map((image, index) => (
              <article key={image.id} className={index === 0 ? "cover" : ""}>
                <img src={image.url} alt={`样品图片 ${index + 1}`} />
                <span>{index === 0 ? "当前封面" : `图片 ${index + 1}`}</span>
                <button
                  type="button"
                  onClick={() => removeImage(image)}
                  disabled={imageBusy}
                >
                  删除
                </button>
              </article>
            ))}
          </div>
        ) : (
          <label className="sample-image-empty">
            尚未添加样品图片，点击选择 JPG、PNG 或 WebP 图片
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={imageBusy}
              onChange={(e) => {
                uploadImages(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </section>
      <section>
        <div className="edit-section-title">
          <h3>基础资料与费用</h3>
          <button type="button" onClick={() => saveSection("基础资料")}>
            保存本区域
          </button>
        </div>
        <div className="sample-edit-grid">
          <label>
            样品编号
            <input value={sample.sample_no} disabled />
          </label>
          <label>
            排版基准
            <input
              type="number"
              min="1"
              value={draft.layoutQuantity}
              onChange={(e) => setDraft("layoutQuantity", e.target.value)}
            />
            <small>默认10套</small>
          </label>
          <label>
            排料参数（间隙 cm）
            <input
              type="number"
              min="0"
              step="any"
              value={draft.gapCm}
              onChange={(e) => setDraft("gapCm", e.target.value)}
            />
          </label>
          <label>
            档案状态
            <input value={sample.status} disabled />
          </label>
          <label>
            客户名称
            <span className="sample-customer-field">
              <select
                value={sample.category || ""}
                onChange={(e) =>
                  setSample((v) => ({ ...v, category: e.target.value }))
                }
              >
                <option value="">请选择客户</option>
                {customers.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button type="button" onClick={addCustomer}>
                新增
              </button>
            </span>
          </label>
          <label>
            特殊工艺
            <input
              value={sample.customer_sku || ""}
              onChange={(e) =>
                setSample((v) => ({ ...v, customer_sku: e.target.value }))
              }
            />
          </label>
          <label>
            做货数量
            <input
              type="number"
              min="1"
              value={draft.productionQuantity}
              onChange={(e) => setDraft("productionQuantity", e.target.value)}
            />
          </label>
          <label>
            颜色
            <input
              value={draft.color || ""}
              onChange={(e) => setDraft("color", e.target.value)}
            />
          </label>
          <label>
            损耗参数 %
            <input
              type="number"
              min="0"
              step="any"
              value={draft.lossRate}
              onChange={(e) => setDraft("lossRate", e.target.value)}
            />
          </label>
          <label>
            单套工价
            <input
              type="number"
              min="0"
              step="any"
              value={draft.processingUnit}
              disabled={draft.processes.length > 0}
              onChange={(e) => setDraft("processingUnit", e.target.value)}
            />
            <small>
              {draft.processes.length
                ? "已按样品工序档案自动汇总"
                : "可手动填写；添加工序后自动汇总"}
            </small>
          </label>
          <label>
            单包利润
            <input
              type="number"
              min="0"
              step="any"
              value={draft.profitUnit}
              onChange={(e) => setDraft("profitUnit", e.target.value)}
            />
          </label>
          <label>
            其他费用（整批）
            <input
              type="number"
              min="0"
              step="any"
              value={draft.otherCost ?? ""}
              onChange={(e) => setDraft("otherCost", e.target.value)}
            />
          </label>
          <label>
            单个包装费
            <input
              type="number"
              min="0"
              step="any"
              value={draft.packagingUnit}
              onChange={(e) => setDraft("packagingUnit", e.target.value)}
            />
          </label>
          <label>
            单个物流费
            <input
              type="number"
              min="0"
              step="any"
              value={draft.logisticsUnit}
              onChange={(e) => setDraft("logisticsUnit", e.target.value)}
            />
          </label>
          <label>
            单个裁剪费
            <input
              type="number"
              min="0"
              step="any"
              value={draft.cuttingUnit}
              onChange={(e) => setDraft("cuttingUnit", e.target.value)}
            />
          </label>
          <label className="sample-edit-notes">
            工艺与核价备注
            <textarea
              value={sample.notes || ""}
              onChange={(e) =>
                setSample((v) => ({ ...v, notes: e.target.value }))
              }
              placeholder="客户提供的原始要求、特殊说明和核价备注"
            />
          </label>
        </div>
      </section>
      <section>
        <div className="edit-section-title">
          <div>
            <h3>样品工序档案</h3>
            <small>
              工序工价自动汇总为单包加工费：{money(draft.processingUnit)}
            </small>
          </div>
          <span className="section-actions">
            <button
              type="button"
              onClick={() =>
                setDraft("processes", [
                  ...draft.processes,
                  {
                    id: `sp${Date.now()}`,
                    workProcessId: null,
                    name: "自定义工序",
                    operationPart: "",
                    quantityPerSet: 1,
                    unitPrice: 0,
                    notes: "",
                  },
                ])
              }
            >
              + 添加工序
            </button>
            <button type="button" onClick={() => saveSection("样品工序")}>
              保存本区域
            </button>
          </span>
        </div>
        <div className="sample-process-editor">
          <div className="sample-editor-head">
            <span>做货顺序</span>
            <span>工序名称（输入或选择）</span>
            <span>操作部位</span>
            <span>单次工价</span>
            <span>单包次数</span>
            <span>操作</span>
          </div>
          {draft.processes.map((item, index) => (
            <article key={item.id}>
              <span className="process-sequence">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="process-combobox">
                <input
                  value={
                    item.processChoice ||
                    (workProcesses.find(
                      (master) =>
                        String(master.id) === String(item.workProcessId),
                    )
                      ? processChoice(
                          workProcesses.find(
                            (master) =>
                              String(master.id) === String(item.workProcessId),
                          ),
                        )
                      : "")
                  }
                  onFocus={() => setProcessMenu(index)}
                  onChange={(e) => {
                    chooseProcessText(index, e.target.value);
                    setProcessMenu(index);
                  }}
                  placeholder="输入工序名称或点击选择"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="process-menu-toggle"
                  onClick={() =>
                    setProcessMenu(processMenu === index ? null : index)
                  }
                >
                  ⌄
                </button>
                {processMenu === index && (
                  <div className="process-options">
                    {processMatches(item).length ? (
                      processMatches(item).map((master) => (
                        <button
                          type="button"
                          key={master.id}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectProcess(index, master)}
                        >
                          <span>
                            <b>{master.name}</b>
                          </span>
                          <strong>{money(master.default_unit_price)}</strong>
                        </button>
                      ))
                    ) : (
                      <div className="process-no-option">
                        没有匹配工序，可直接作为自定义名称
                      </div>
                    )}
                  </div>
                )}
              </div>
              <input
                value={item.operationPart || ""}
                onChange={(e) =>
                  process(index, "operationPart", e.target.value)
                }
                placeholder="操作部位"
              />
              <input
                type="number"
                min="0"
                step="any"
                value={item.unitPrice}
                onChange={(e) => process(index, "unitPrice", e.target.value)}
                placeholder="单次工价"
              />
              <input
                type="number"
                min="0"
                step="any"
                value={item.quantityPerSet}
                onChange={(e) =>
                  process(index, "quantityPerSet", e.target.value)
                }
                placeholder="次数/包"
              />
              <button
                className="danger"
                onClick={() =>
                  setDraft(
                    "processes",
                    draft.processes.filter((_, i) => i !== index),
                  )
                }
              >
                ×
              </button>
            </article>
          ))}
        </div>
      </section>
      <section>
        <div className="edit-section-title">
          <h3>布料与裁片</h3>
          <span className="section-actions">
            <button
              onClick={() =>
                setDraft("materials", [
                  ...draft.materials,
                  {
                    id: `m${Date.now()}`,
                    name: "新布料",
                    widthCm: 148,
                    color: "",
                    unitPrice: "",
                    pieces: [],
                  },
                ])
              }
            >
              + 添加布料
            </button>
            <button type="button" onClick={() => saveSection("布料与裁片")}>
              保存本区域
            </button>
          </span>
        </div>
        {draft.materials.map((item, mi) => (
          <article className="sample-edit-material" key={item.id}>
            <div className="material-edit-head">
              <input
                value={item.name}
                onChange={(e) => material(mi, "name", e.target.value)}
                placeholder="布料名称"
              />
              <input
                value={item.color || ""}
                onChange={(e) => material(mi, "color", e.target.value)}
                placeholder="颜色"
              />
              <input
                type="number"
                value={item.widthCm ?? 148}
                onChange={(e) => material(mi, "widthCm", e.target.value)}
                placeholder="幅宽 cm"
              />
              <input
                type="number"
                value={item.unitPrice ?? ""}
                onChange={(e) => material(mi, "unitPrice", e.target.value)}
                placeholder="单价 元/米"
              />
              <button
                className="danger"
                onClick={() =>
                  setDraft(
                    "materials",
                    draft.materials.filter((_, i) => i !== mi),
                  )
                }
              >
                删除
              </button>
            </div>
            {item.pieces.map((part, pi) => (
              <div className="sample-edit-piece" key={part.id}>
                <input
                  value={part.name}
                  onChange={(e) => piece(mi, pi, "name", e.target.value)}
                  placeholder="裁片名称"
                />
                <input
                  type="number"
                  value={part.lengthCm ?? ""}
                  onChange={(e) => piece(mi, pi, "lengthCm", e.target.value)}
                  placeholder="长 cm"
                />
                <input
                  type="number"
                  value={part.widthCm ?? ""}
                  onChange={(e) => piece(mi, pi, "widthCm", e.target.value)}
                  placeholder="宽 cm"
                />
                <input
                  type="number"
                  value={part.quantityPerSet ?? ""}
                  onChange={(e) =>
                    piece(mi, pi, "quantityPerSet", e.target.value)
                  }
                  placeholder="片/套"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={part.rotatable !== false}
                    onChange={(e) =>
                      piece(mi, pi, "rotatable", e.target.checked)
                    }
                  />
                  可旋转
                </label>
                <button
                  className="danger"
                  onClick={() =>
                    material(
                      mi,
                      "pieces",
                      item.pieces.filter((_, i) => i !== pi),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              className="row-add"
              onClick={() =>
                material(mi, "pieces", [
                  ...item.pieces,
                  {
                    id: `p${Date.now()}`,
                    name: "新裁片",
                    lengthCm: "",
                    widthCm: 148,
                    quantityPerSet: 1,
                    rotatable: true,
                  },
                ])
              }
            >
              + 添加裁片
            </button>
          </article>
        ))}
      </section>
      <section>
        <div className="edit-section-title">
          <h3>配件与五金</h3>
          <span className="section-actions">
            <button
              onClick={() =>
                setDraft("accessories", [
                  ...draft.accessories,
                  {
                    id: `a${Date.now()}`,
                    name: "新配件",
                    specification: "",
                    quantityPerSet: 1,
                    unit: "个",
                    unitPrice: "",
                  },
                ])
              }
            >
              + 添加配件
            </button>
            <button type="button" onClick={() => saveSection("配件与五金")}>
              保存本区域
            </button>
          </span>
        </div>
        <div className="accessory-editor-head">
          <span>项目名称</span>
          <span>规格</span>
          <span>单包用量</span>
          <span>单位</span>
          <span>单价</span>
          <span>操作</span>
        </div>
        {draft.accessories.map((item, index) => (
          <div className="sample-edit-accessory" key={item.id}>
            <input
              value={item.name}
              onChange={(e) => accessory(index, "name", e.target.value)}
              placeholder="配件名称"
            />
            <input
              value={item.specification || ""}
              onChange={(e) =>
                accessory(index, "specification", e.target.value)
              }
              placeholder="规格"
            />
            <input
              type="number"
              value={item.quantityPerSet ?? ""}
              onChange={(e) =>
                accessory(index, "quantityPerSet", e.target.value)
              }
              placeholder="单套用量"
            />
            <input
              value={item.unit || ""}
              onChange={(e) => accessory(index, "unit", e.target.value)}
              placeholder="单位"
            />
            <input
              type="number"
              value={item.unitPrice ?? ""}
              onChange={(e) => accessory(index, "unitPrice", e.target.value)}
              placeholder="单价"
            />
            <button
              className="danger"
              onClick={() =>
                setDraft(
                  "accessories",
                  draft.accessories.filter((_, i) => i !== index),
                )
              }
            >
              ×
            </button>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function SampleQuoteWorkspace() {
  const [samples, setSamples] = useState([]);
  const [sample, setSample] = useState(null);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState("archive");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [workProcesses, setWorkProcesses] = useState([]);
  const scrollRef = useRef(null);
  const reload = async (preferred) => {
    const rows = await api("/sample-quotes");
    setSamples(rows);
    const id = preferred || sample?.id || rows[0]?.id;
    setSample(
      id
        ? await api(`/sample-quotes/${id}`)
        : await api("/sample-quotes", { method: "POST", body: "{}" }),
    );
  };
  useEffect(() => {
    reload().catch((error) => setNotice(error.message));
    Promise.all([api("/customers"), api("/work-processes")])
      .then(([customerRows, processRows]) => {
        setCustomers(customerRows);
        setWorkProcesses(processRows);
      })
      .catch((error) => setNotice(error.message));
  }, []);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [sample?.messages?.length, busy]);
  const create = async () => {
    try {
      setBusy(true);
      const item = await api("/sample-quotes", { method: "POST", body: "{}" });
      await reload(item.id);
      setEditing(false);
      setTab("archive");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const uploadFiles = async (files) => {
    if (!sample || !files?.length) return;
    const selected = [...files];
    setPendingFiles(
      selected.map((file) => ({ name: file.name, size: file.size })),
    );
    try {
      setBusy(true);
      setNotice("正在识别资料内容并交给AI分析，请稍候…");
      let updated;
      for (const file of selected)
        updated = await api(`/sample-quotes/${sample.id}/attachments`, {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            dataUrl: await toDataUrl(file),
          }),
        });
      setSample(updated || (await api(`/sample-quotes/${sample.id}`)));
      const rows = await api("/sample-quotes");
      setSamples(rows);
      setNotice(
        `AI已读取并分析 ${selected.length} 个附件，识别结果已进入对话和右侧档案`,
      );
      window.location.hash = "#/quotations";
    } catch (error) {
      setSample(await api(`/sample-quotes/${sample.id}`).catch(() => sample));
      setNotice(`资料识别失败：${error.message}`);
    } finally {
      setPendingFiles([]);
      setBusy(false);
    }
  };
  const uploadImages = async (files) => {
    if (!sample || !files?.length) return;
    const selected = [...files];
    try {
      setBusy(true);
      for (const file of selected)
        await api(`/sample-quotes/${sample.id}/images`, {
          method: "POST",
          body: JSON.stringify({
            dataUrl: await toDataUrl(file),
            notes: file.name,
          }),
        });
      setSample(await api(`/sample-quotes/${sample.id}`));
      setNotice(`已上传 ${selected.length} 张样品图片，最新图片已设为封面`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const removeImage = async (image) => {
    if (
      !sample ||
      !confirm(
        `确定删除这张样品图片吗？${sample.images?.[0]?.id === image.id ? " 删除后下一张图片将成为封面。" : ""}`,
      )
    )
      return;
    try {
      setBusy(true);
      await api(`/sample-quotes/${sample.id}/images/${image.id}`, {
        method: "DELETE",
      });
      setSample(await api(`/sample-quotes/${sample.id}`));
      setNotice("样品图片已删除");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const addCustomer = async () => {
    const name = prompt("请输入客户名称");
    if (!name?.trim()) return;
    try {
      const created = await api("/customers", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      setCustomers((rows) =>
        [...rows, created].sort((a, b) =>
          a.name.localeCompare(b.name, "zh-CN"),
        ),
      );
      setSample((current) => ({ ...current, category: created.name }));
      setNotice(`客户“${created.name}”已加入客户信息库`);
    } catch (error) {
      setNotice(error.message);
    }
  };
  const send = async () => {
    if (!message.trim() || !sample) return;
    const text = message;
    setMessage("");
    setSample((current) => ({
      ...current,
      messages: [
        ...current.messages,
        { id: `temp-${Date.now()}`, role: "user", content: text },
      ],
    }));
    try {
      setBusy(true);
      const updated = await api(`/sample-quotes/${sample.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setSample(updated);
      const rows = await api("/sample-quotes");
      setSamples(rows);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (calculate) => {
    try {
      setBusy(true);
      let updated = await api(`/sample-quotes/${sample.id}`, {
        method: "PUT",
        body: JSON.stringify({
          draft: sample.draft,
          specialProcess: sample.customer_sku,
          customerName: sample.category,
          notes: sample.notes,
        }),
      });
      if (calculate)
        updated = await api(`/sample-quotes/${sample.id}/calculate`, {
          method: "POST",
          body: JSON.stringify({ draft: updated.draft }),
        });
      setSample(updated);
      setEditing(false);
      if (calculate) setTab("cost");
      setNotice(
        calculate
          ? "已按排版基准计算单套用料，并生成做货数量成本"
          : "样品档案已保存",
      );
      const rows = await api("/sample-quotes");
      setSamples(rows);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const saveSection = async (sectionName) => {
    try {
      setBusy(true);
      const updated = await api(`/sample-quotes/${sample.id}`, {
        method: "PUT",
        body: JSON.stringify({
          draft: sample.draft,
          specialProcess: sample.customer_sku,
          customerName: sample.category,
          notes: sample.notes,
        }),
      });
      setSample(updated);
      setSamples(await api("/sample-quotes"));
      setNotice(`${sectionName}已单独保存`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const convertQuotation = async () => {
    try {
      setBusy(true);
      const result = await api(`/sample-quotes/${sample.id}/quotation`, {
        method: "POST",
        body: "{}",
      });
      setNotice(
        result.alreadyCreated
          ? `该样品已有草稿报价单：${result.quote_no}`
          : `已生成报价单：${result.quote_no}`,
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  const convert = async () => {
    const sku = prompt(
      "请输入正式产品货号",
      sample.customer_sku || sample.sample_no,
    );
    if (!sku) return;
    const name = prompt("请输入正式产品名称", sample.sample_no);
    if (!name) return;
    try {
      setBusy(true);
      const result = await api(`/sample-quotes/${sample.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ sku, name, category: sample.category }),
      });
      setNotice(`已转为正式产品：${result.sku}`);
      setSample(await api(`/sample-quotes/${sample.id}`));
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };
  if (!sample)
    return (
      <section className="panel loading">
        {notice || "正在准备样品档案…"}
      </section>
    );
  return (
    <>
      <header>
        <div>
          <p>AI QUOTING / SAMPLE ARCHIVE</p>
          <h1>AI 新产品核价助手</h1>
        </div>
        <div className="sample-top-actions">
          <select
            value={sample.id}
            onChange={(e) => {
              setEditing(false);
              setTab("archive");
              reload(Number(e.target.value));
            }}
          >
            {samples.map((item) => (
              <option key={item.id} value={item.id}>
                {item.sample_no} · {item.status}
              </option>
            ))}
          </select>
          <button onClick={create}>+ 新建样品</button>
        </div>
      </header>
      {notice && <div className="notice neutral">{notice}</div>}
      <section className="sample-ai-layout refined">
        <section className="panel sample-chat model-chat">
          <div className="model-chat-title">
            <div className="model-avatar">AI</div>
            <div>
              <b>核价助手</b>
              <small>排料与成本核算</small>
            </div>
            <span>在线</span>
          </div>
          <div className="sample-messages" ref={scrollRef}>
            {sample.messages.map((item) => (
              <article className={item.role} key={item.id}>
                <div className="message-avatar">
                  {item.role === "user" ? "你" : "AI"}
                </div>
                <div>
                  <b>{item.role === "user" ? "你" : "核价助手"}</b>
                  <p>{item.content}</p>
                </div>
              </article>
            ))}
            {busy && (
              <article className="assistant thinking">
                <div className="message-avatar">AI</div>
                <div>
                  <b>核价助手</b>
                  <p>正在处理资料…</p>
                </div>
              </article>
            )}
          </div>
          {(sample.attachments?.length > 0 || pendingFiles.length > 0) && (
            <div className="chat-file-tray">
              {sample.attachments.slice(-4).map((file) => (
                <a
                  className={`recognition-${file.recognition_status || "pending"}`}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  key={file.id}
                >
                  <i>
                    {file.recognition_status === "recognized"
                      ? "✓"
                      : file.recognition_status === "failed"
                        ? "!"
                        : "…"}
                  </i>
                  <span>
                    {file.name}
                    <small>{file.recognition_summary || "等待AI读取"}</small>
                  </span>
                </a>
              ))}
              {pendingFiles.map((file) => (
                <span key={file.name}>
                  <i>◌</i>
                  {file.name}
                  <small>正在识别并分析</small>
                </span>
              ))}
            </div>
          )}
          <div className="model-composer">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="输入裁片尺寸、布料、配件或费用，AI会继续核对并给出最终价格…"
            />
            <div>
              <label
                className="attach-button"
                title="添加图片或资料，AI将自动识别内容"
              >
                ＋
                <input
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp,.pdf,.txt,.csv,.xls,.xlsx,.docx"
                  disabled={busy}
                  onChange={(e) => {
                    uploadFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              <small>添加图片/资料后，AI自动读取并整理档案</small>
              <button
                className="primary"
                onClick={send}
                disabled={busy || !message.trim()}
              >
                发送
              </button>
            </div>
          </div>
        </section>
        <section className="sample-archive refined-archive">
          <section className="panel sample-workspace-card">
            <div className="archive-toolbar workspace-toolbar">
              <div>
                <p>TEMPORARY SAMPLE</p>
                <h2>{sample.sample_no}</h2>
                <span>
                  {sample.status} · {sample.category || "未分类"}
                </span>
              </div>
              <div>
                {tab === "archive" &&
                  (editing ? (
                    <>
                      <button
                        onClick={() => {
                          setEditing(false);
                          reload(sample.id);
                        }}
                      >
                        取消
                      </button>
                      <button className="primary" onClick={() => save(false)}>
                        保存档案
                      </button>
                    </>
                  ) : (
                    <button
                      className="archive-edit"
                      onClick={() => setEditing(true)}
                    >
                      修改档案
                    </button>
                  ))}
              </div>
            </div>
            <nav className="sample-workspace-tabs">
              <button
                className={tab === "archive" ? "active" : ""}
                onClick={() => setTab("archive")}
              >
                样品档案
              </button>
              <button
                className={tab === "cost" ? "active" : ""}
                onClick={() => {
                  setEditing(false);
                  setTab("cost");
                }}
              >
                成本明细{sample.result ? "" : " · 待核价"}
              </button>
              <button
                className={tab === "packing" ? "active" : ""}
                onClick={() => {
                  setEditing(false);
                  setTab("packing");
                }}
              >
                排料图
                {sample.result
                  ? ` · ${Array.isArray(sample.result.materials) ? sample.result.materials.length : 0}`
                  : ""}
              </button>
            </nav>
            <div className="sample-tab-content">
              {tab === "archive" && (
                <>
                  {editing ? (
                    <EditArchive
                      sample={sample}
                      setSample={setSample}
                      uploadImages={uploadImages}
                      removeImage={removeImage}
                      imageBusy={busy}
                      customers={customers}
                      workProcesses={workProcesses}
                      addCustomer={addCustomer}
                      saveSection={saveSection}
                    />
                  ) : (
                    <ReadArchive sample={sample} />
                  )}
                  {sample.draft.missingFields?.length > 0 && (
                    <div className="sample-missing">
                      <b>资料仍需完善</b>
                      {sample.draft.missingFields.slice(0, 5).map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  )}
                  <div className="archive-actions">
                    <button
                      className="primary"
                      onClick={() => save(true)}
                      disabled={busy}
                    >
                      按基准排版并核价
                    </button>
                    {sample.status === "已核价" && (
                      <button className="quotation" onClick={convertQuotation}>
                        转为报价单 →
                      </button>
                    )}
                    {sample.status === "已核价" && (
                      <button className="convert" onClick={convert}>
                        转为正式产品 →
                      </button>
                    )}
                  </div>
                </>
              )}
              {tab === "cost" &&
                (sample.result ? (
                  <CostSnapshot sample={sample} />
                ) : (
                  <div className="archive-empty tab-empty">
                    <b>尚未生成成本结果</b>
                    <span>
                      完善档案后点击“排料并核价”，这里会同时展示单套与整批成本。
                    </span>
                  </div>
                ))}
              {tab === "packing" && <PackingWorkspace sample={sample} />}
            </div>
          </section>
        </section>
      </section>
    </>
  );
}
