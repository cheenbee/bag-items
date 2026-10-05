# 箱包行业产品数字化管理系统

箱包款式、材料、裁片、工艺、报价和生产资料管理项目。

## 项目数据

`data/bpms.db` 和 `data/uploads/` 随项目保存，包含 2026-10-01 从线上同步的数据库和上传图片。这是数据快照，克隆仓库不会自动连接或同步线上数据库。旧备份、环境密钥及面板登录信息不上传。

## 本地开发

需要 Node.js 22.13 或更高版本。

```powershell
Copy-Item .env.example .env
Copy-Item .env.ai.example .env.ai
npm ci
npm run dev
```

在 `.env` 中填写独立生成的 JWT 密钥和管理员密码。开发环境按模板读取 `data/bpms.db` 和 `data/uploads/`。AI 配置按需填写。前端默认地址为 http://localhost:5173。

## Docker 部署

安装 Docker 后复制配置模板，填写 `JWT_SECRET`、`ADMIN_PASSWORD` 和 `S3_SECRET_ACCESS_KEY`。生产环境 JWT 密钥至少 48 位，管理员密码至少 12 位。

```powershell
docker compose up -d --build
```

默认访问 http://localhost:8080。数据库和上传目录由 Compose 挂载；对象存储由 MinIO 提供。其他部署资料见 `deploy/` 和 `部署说明.txt`。

## 检查

```powershell
npm run check
npm run build
```

数据库属于业务资料，建议将仓库设为私有。提交新的数据库快照前应先备份并检查完整性；Git 不提供实时数据同步。
